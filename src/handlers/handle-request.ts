import { Request, Response } from "express";
import Proxy from "../proxy";
import Connection from "../connection";
import ForwardedRequestMessage from "../messages/forwarded-request-message";
import ForwardedResponseMessage from "../messages/forwarded-response-message";
import ForwardedResponseStreamStartMessage from "../messages/forwarded-response-stream-start-message";
import ForwardedResponseStreamChunkMessage from "../messages/forwarded-response-stream-chunk-message";
import CancelForwardedRequestMessage from "../messages/cancel-forwarded-request-message";
import { nanoid } from 'nanoid';
import { logResponse } from "../logging/log-response";
import { createRequestLog, pruneRequestLogsOlderThanDays } from "../repository/request-log-repository";

const capitalize = require('capitalize');
const tenMinutesInMilliseconds = 300000;
const STREAMED_RESPONSE_BODY_PLACEHOLDER = Buffer.from('[streamed response: body streamed directly to client]').toString('base64');

const handleRequest = async function(request : Request, response : Response) {
    const proxy = Proxy.getInstance();
    const url = new URL('https://' + request.headers.host);
    const hostname = url.hostname;
    const requestId = nanoid();
    const connection : Connection = proxy.findConnectionByHostname(hostname);

    if (typeof connection === 'undefined') {
        response.status(404);
        response.send("No matching tunnelmole domain for " + hostname);
        return;
    }

    const headers = {};
    for (const key in request.headers) {
        const name = capitalize.words(key);
        const value = request.headers[key];
        headers[name] = value;
    }

    const shouldStream = shouldStreamResponse(request);

    // Get the request body, whether binary or text as a base64 string for trouble-free transmission over the WebSocket connection
    // Unless it's just an empty object, then set it to an empty string
    const body = JSON.stringify(request.body) === JSON.stringify({}) ? '' : request.body.toString('base64');

    const forwardedRequest : ForwardedRequestMessage = {
        requestId,
        type: "forwardedRequest",
        url : request.originalUrl,
        method : request.method,
        headers,
        body,
        responseMode: shouldStream ? 'stream' : 'buffer'
    }

    const requestLogContext = {
        hostname,
        method: request.method,
        path: request.originalUrl,
        requestHeaders: headers,
        requestBody: body
    };

    connection.websocket.sendMessage(forwardedRequest);

    let listenerRemoved = false;
    let streamingCompleted = false;
    let streamingHeaders: Record<string, any> | undefined;
    let streamingStatusCode: number | undefined;

    const removeForwardedResponseHandler = () => {
        if (listenerRemoved) {
            return;
        }

        connection.websocket.removeListener('message', forwardedResponseHandler);
        listenerRemoved = true;
    };

    const persistRequestLog = (statusCode: number, responseHeaders: Record<string, any>, responseBody: string) => {
        createRequestLog({
            hostname: requestLogContext.hostname,
            method: requestLogContext.method,
            path: requestLogContext.path,
            requestHeaders: requestLogContext.requestHeaders,
            requestBody: requestLogContext.requestBody,
            responseStatus: statusCode,
            responseHeaders,
            responseBody
        }).catch((error) => {
            console.error('Failed to persist request log:', error);
        });

        pruneRequestLogsOlderThanDays(14).catch((error) => {
            console.error('Failed to prune old request logs:', error);
        });
    };

    const forwardedResponseHandler = (text: string) => {
        try {
            const parsedMessage = JSON.parse(text);

            if (parsedMessage.requestId !== requestId) {
                return;
            }

            if (shouldStream) {
                if (parsedMessage.type === 'forwardedResponseStreamStart') {
                    const startMessage: ForwardedResponseStreamStartMessage = parsedMessage;
                    const startHeaders = startMessage.headers || {};
                    startHeaders['x-forwarded-for'] = connection.websocket.ipAddress;
                    const sanitizedHeaders = sanitizeForwardedResponseHeaders(startHeaders);
                    streamingHeaders = sanitizedHeaders;
                    streamingStatusCode = startMessage.statusCode;

                    response.status(startMessage.statusCode);
                    for (const name in sanitizedHeaders) {
                        const value = sanitizedHeaders[name];
                        response.header(capitalize.words(name), value);
                    }

                    if (typeof response.flushHeaders === 'function') {
                        response.flushHeaders();
                    }

                    return;
                }

                if (parsedMessage.type === 'forwardedResponseStreamChunk') {
                    const chunkMessage: ForwardedResponseStreamChunkMessage = parsedMessage;
                    const chunk = Buffer.from(chunkMessage.body || '', 'base64');

                    if (chunk.length > 0) {
                        response.write(chunk);
                    }

                    if (chunkMessage.isFinal) {
                        streamingCompleted = true;
                        response.end();
                        removeForwardedResponseHandler();
                        persistRequestLog(
                            streamingStatusCode || 200,
                            streamingHeaders || {},
                            STREAMED_RESPONSE_BODY_PLACEHOLDER
                        );
                    }

                    return;
                }
            }

            if (parsedMessage.type === 'forwardedResponse') {
                const forwardedResponseMessage : ForwardedResponseMessage = parsedMessage;
                logResponse(forwardedResponseMessage, hostname); // Log if debug logging is enabled
                forwardedResponseMessage.headers['x-forwarded-for'] = connection.websocket.ipAddress;
                const responseBody = Buffer.from(forwardedResponseMessage.body, 'base64');
                const sanitizedHeaders = sanitizeForwardedResponseHeaders(forwardedResponseMessage.headers, responseBody.length);

                response.status(forwardedResponseMessage.statusCode);

                for (const name in sanitizedHeaders) {
                    const value = sanitizedHeaders[name];
                    response.header(capitalize.words(name), value);
                }

                response.send(responseBody);

                persistRequestLog(
                    forwardedResponseMessage.statusCode,
                    sanitizedHeaders,
                    forwardedResponseMessage.body
                );

                removeForwardedResponseHandler();
            }
        } catch (error) {
            // Log errors and remove listener
            console.error("Caught error in forwardedResponseHandler for request id " + requestId + ":" + error.message);
            console.error(error);
            removeForwardedResponseHandler();
        }
    }

    // Set a new message listener on the clients websocket connection to handle the response
    connection.websocket.on('message', forwardedResponseHandler);

    if (!shouldStream) {
        // Remove the listener automatically after 10 minutes, if its not already gone
        setTimeout(() => {
            removeForwardedResponseHandler();
        }, tenMinutesInMilliseconds);
    }

    if (shouldStream) {
        response.on('close', () => {
            if (streamingCompleted) {
                return;
            }

            const cancelMessage: CancelForwardedRequestMessage = {
                type: 'cancelForwardedRequest',
                requestId
            };

            try {
                connection.websocket.sendMessage(cancelMessage);
            } catch (error) {
                console.error('Failed to send cancelForwardedRequest message:', error);
            } finally {
                removeForwardedResponseHandler();
            }
        });
    }

    return;
}

const sanitizeForwardedResponseHeaders = (headers: Record<string, any>, bodyLength?: number): Record<string, any> => {
    const sanitized: Record<string, any> = {};
    const forbiddenHeaders = ['transfer-encoding', 'content-length'];

    if (headers && typeof headers === 'object') {
        for (const name in headers) {
            if (!Object.prototype.hasOwnProperty.call(headers, name)) {
                continue;
            }
            const value = headers[name];

            if (typeof value === 'undefined') {
                continue;
            }

            if (forbiddenHeaders.includes(name.toLowerCase())) {
                continue;
            }

            sanitized[name] = value;
        }
    }

    if (typeof bodyLength === 'number') {
        sanitized['content-length'] = bodyLength.toString();
    }

    return sanitized;
}

const shouldStreamResponse = (request: Request): boolean => {
    const acceptHeader = request.headers['accept'];

    if (!acceptHeader) {
        return false;
    }

    const values = Array.isArray(acceptHeader) ? acceptHeader : [acceptHeader];

    return values
        .filter((value): value is string => typeof value === 'string')
        .some((value) => value.toLowerCase().includes('text/event-stream'));
}

export default handleRequest;
