import { Request, Response } from "express";
import Proxy from "../proxy";
import { nanoid } from "nanoid";
import ForwardedRequestMessage from "../messages/forwarded-request-message";
import ForwardedResponseMessage from "../messages/forwarded-response-message";
import { RequestLog } from "../model/request-log";
import {
    createRequestLog,
    deleteRequestLogsByHostname,
    findRecentRequestLogsByHostname,
    findRequestLogById,
    pruneRequestLogsOlderThanDays
} from "../repository/request-log-repository";
import { getRequestLogPassword } from "../repository/request-log-credentials-repository";

interface FlashMessage {
    success?: string;
    error?: string;
}

const htmlEscape = (value: string) =>
    value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");

const decodeBody = (base64Body: string): string => {
    if (!base64Body) {
        return '';
    }

    try {
        return Buffer.from(base64Body, 'base64').toString('utf8');
    } catch (error) {
        console.error('Failed to decode request log body:', error);
        return '';
    }
};

const formatJson = (payload: Record<string, any>): string => {
    if (!payload || Object.keys(payload).length === 0) {
        return 'None';
    }

    return JSON.stringify(payload, null, 2);
};

const renderBodySection = (title: string, base64Body: string): string => {
    if (!base64Body) {
        return `<section><h4>${title}</h4><div class="muted">Empty</div></section>`;
    }

    const decoded = decodeBody(base64Body);
    const readableBody = decoded ? htmlEscape(decoded) : '<em>Binary data (see raw)</em>';

    return `
        <section>
            <h4>${title}</h4>
            <pre style="white-space: pre-wrap;">${readableBody}</pre>
            <details>
                <summary>Raw (base64)</summary>
                <pre>${htmlEscape(base64Body)}</pre>
            </details>
        </section>
    `;
};

const renderFlash = (flash?: FlashMessage): string => {
    if (!flash) {
        return '';
    }

    if (flash.error) {
        return `<div class="flash flash-error">${htmlEscape(flash.error)}</div>`;
    }

    if (flash.success) {
        return `<div class="flash flash-success">${htmlEscape(flash.success)}</div>`;
    }

    return '';
};

const renderEntry = (log: RequestLog, token?: string): string => {
    const createdAt = log.createdAt ? new Date(log.createdAt).toLocaleString('de-DE') : 'Unknown time';
    const headersSection = htmlEscape(formatJson(log.requestHeaders));
    const responseHeadersSection = htmlEscape(formatJson(log.responseHeaders));
    const tokenInput = token ? `<input type="hidden" name="token" value="${htmlEscape(token)}" />` : '';
    const detailsId = typeof log.id !== 'undefined' ? `log-details-${log.id}` : `log-details-${nanoid(8)}`;

    const replayButton = typeof log.id !== 'undefined'
        ? `
            <form method="post" class="inline-form">
                <input type="hidden" name="action" value="replay" />
                <input type="hidden" name="logId" value="${log.id}" />
                ${tokenInput}
                <button type="submit" class="btn">Replay</button>
            </form>
        `
        : '';

    const detailsButton = `
        <button type="button" class="btn toggle-details" data-target="${detailsId}">Details</button>
    `;

    return `
        <article class="log-entry toggle-details" data-target="${detailsId}">
            <header>
                <span class="method">${htmlEscape(log.method)}</span>
                <span class="path">${htmlEscape(log.path)}</span>
                <span class="status ${log.responseStatus && log.responseStatus >= 400 ? 'status-error' : ''}">${log.responseStatus ?? '—'}</span>
                <span class="timestamp">${htmlEscape(createdAt)}</span>
                <div class="actions">
                    ${detailsButton}
                    ${replayButton}
                </div>
            </header>
            <section id="${detailsId}" class="details-panel" hidden>
                <section>
                    <h4>Request Headers</h4>
                    <pre>${headersSection}</pre>
                </section>
                ${renderBodySection('Request Body', log.requestBody)}
                <section>
                    <h4>Response Headers</h4>
                    <pre>${responseHeadersSection}</pre>
                </section>
                ${renderBodySection('Response Body', log.responseBody)}
            </section>
        </article>
    `;
};

const renderPage = (hostname: string, logs: RequestLog[], flash?: FlashMessage, token?: string): string => {
    const entries = logs.length > 0
        ? logs.map((log) => renderEntry(log, token)).join('\n')
        : '<p class="muted">No requests logged for this endpoint yet.</p>';

    const flashMarkup = renderFlash(flash);
    const tokenInput = token ? `<input type="hidden" name="token" value="${htmlEscape(token)}" />` : '';
    const helperMessage = token
        ? `<p class="muted">Bookmark this page with <code>?token=${htmlEscape(token)}</code> to skip typing the password again.</p>`
        : '';

    return `
        <!doctype html>
        <html lang="en">
        <head>
            <meta charset="utf-8" />
            <title>Request Logs for ${htmlEscape(hostname)}</title>
            <style>
                body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background-color: #0d1117; color: #e6edf3; margin: 0; padding: 2rem; }
                h1 { margin-top: 0; }
                .muted { color: #8b949e; }
                .log-entry { background: #161b22; border: 1px solid #30363d; border-radius: 8px; margin-bottom: 1rem; padding: 1rem; }
                .log-entry header { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; }
                .method { font-weight: 600; }
                .path { flex: 1; font-family: monospace; }
                .status { font-weight: 600; }
                .status-error { color: #f85149; }
                .timestamp { font-size: 0.9rem; color: #8b949e; }
                details { margin-top: 0.5rem; }
                pre { background: #0d1117; border: 1px solid #30363d; border-radius: 6px; padding: 0.75rem; overflow-x: auto; }
                section { margin: 0.5rem 0; }
                summary { cursor: pointer; }
                details > summary { font-weight: 600; }
                form.toolbar { margin: 1rem 0; }
                form.inline-form { display: inline-block; margin-left: 0.5rem; }
                .btn { background: #238636; border: 1px solid #2ea043; color: #fff; padding: 0.35rem 0.75rem; border-radius: 6px; cursor: pointer; font-size: 0.85rem; }
                .btn:hover { background: #2ea043; }
                .actions { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; }
                .details-panel { margin-top: 0.75rem; }
                .flash { padding: 0.75rem 1rem; border-radius: 6px; margin-bottom: 1rem; }
                .flash-success { background: #1f6feb33; border: 1px solid #1f6feb; }
                .flash-error { background: #f8514933; border: 1px solid #f85149; }
            </style>
            <script>
                document.addEventListener('click', (event) => {
                    const target = event.target;
                    event.preventDefault();
                    event.stopPropagation();
                    if (!(target instanceof HTMLElement)) {
                        return;
                    }
                    if (target.classList.contains('toggle-details')) {
                        const panelId = target.getAttribute('data-target');
                        if (!panelId) {
                            return;
                        }
                        const panel = document.getElementById(panelId);
                        if (!panel) {
                            return;
                        }
                        const isHidden = panel.hasAttribute('hidden');
                        if (isHidden) {
                            panel.removeAttribute('hidden');
                            target.textContent = 'Hide';
                        } else {
                            panel.setAttribute('hidden', 'true');
                            target.textContent = 'Details';
                        }
                    }
                });
            </script>
        </head>
        <body>
            <h1>Request Logs</h1>
            <p class="muted">Hostname: ${htmlEscape(hostname)} &middot; Bodies are decoded as UTF-8 and raw base64 copies are available.</p>
            ${flashMarkup}
            ${helperMessage}
            <form method="post" class="toolbar">
                <input type="hidden" name="action" value="prune" />
                ${tokenInput}
                <button type="submit" class="btn">Prune All Logs For This Host</button>
            </form>
            ${entries}
        </body>
        </html>
    `;
};

const formDataFromRequest = (request: Request): URLSearchParams => {
    if (!request.body) {
        return new URLSearchParams();
    }

    if (Buffer.isBuffer(request.body)) {
        return new URLSearchParams(request.body.toString('utf8'));
    }

    if (typeof request.body === 'string') {
        return new URLSearchParams(request.body);
    }

    return new URLSearchParams();
};

const extractTokenFromAuthorization = (header?: string | string[]): string | undefined => {
    if (typeof header !== 'string') {
        return undefined;
    }

    const value = header.trim();

    if (value.toLowerCase().startsWith('bearer ')) {
        return value.slice(7).trim();
    }

    if (value.toLowerCase().startsWith('basic ')) {
        try {
            const decoded = Buffer.from(value.slice(6).trim(), 'base64').toString('utf8');
            const [, password] = decoded.split(':');
            return password;
        } catch (error) {
            console.error('Failed to decode basic auth header:', error);
        }
    }

    return undefined;
};

const resolveRequestPassword = (request: Request, formData?: URLSearchParams): string | undefined => {
    const bodyToken = formData?.get('token') ?? undefined;
    const queryToken = typeof request.query.token === 'string' ? request.query.token : undefined;
    const headerToken = extractTokenFromAuthorization(request.headers['authorization']);

    return bodyToken ?? queryToken ?? headerToken;
};

const REPLAY_TIMEOUT_MS = 30000;

const replayRequestThroughTunnel = async (log: RequestLog): Promise<ForwardedResponseMessage> => {
    const proxy = Proxy.getInstance();
    const connection = proxy.findConnectionByHostname(log.hostname);

    if (!connection) {
        throw new Error('No active tunnel for this hostname.');
    }

    return new Promise((resolve, reject) => {
        const requestId = nanoid();
        const forwardedRequest: ForwardedRequestMessage = {
            requestId,
            type: 'forwardedRequest',
            url: log.path,
            method: log.method,
            headers: log.requestHeaders,
            body: log.requestBody
        };

        const cleanup = () => {
            connection.websocket.removeListener('message', forwardedResponseHandler);
            clearTimeout(timeoutHandle);
        };

        const timeoutHandle = setTimeout(() => {
            cleanup();
            reject(new Error('Timed out while waiting for replay response.'));
        }, REPLAY_TIMEOUT_MS);

        const forwardedResponseHandler = (text: string) => {
            try {
                const forwardedResponseMessage: ForwardedResponseMessage = JSON.parse(text);

                if (forwardedResponseMessage.requestId !== requestId) {
                    return;
                }

                if (forwardedResponseMessage.type === 'forwardedResponse') {
                    cleanup();
                    resolve(forwardedResponseMessage);
                }
            } catch (error) {
                console.error('Failed to parse forwarded response during replay:', error);
            }
        };

        connection.websocket.on('message', forwardedResponseHandler);

        try {
            connection.websocket.sendMessage(forwardedRequest);
        } catch (error) {
            cleanup();
            reject(error);
        }
    });
};

const handleReplayAction = async (hostname: string, logId: number): Promise<FlashMessage> => {
    if (!Number.isFinite(logId)) {
        return { error: 'Invalid log id.' };
    }

    const log = await findRequestLogById(logId);

    if (!log || log.hostname !== hostname) {
        return { error: 'Request log not found for this host.' };
    }

    try {
        const forwardedResponse = await replayRequestThroughTunnel(log);

        await createRequestLog({
            hostname: log.hostname,
            method: log.method,
            path: log.path,
            requestHeaders: log.requestHeaders,
            requestBody: log.requestBody,
            responseStatus: forwardedResponse.statusCode,
            responseHeaders: forwardedResponse.headers,
            responseBody: forwardedResponse.body
        });

        return {
            success: `Replayed ${log.method} ${log.path} (status ${forwardedResponse.statusCode}).`
        };
    } catch (error) {
        console.error('Failed to replay request log:', error);
        return { error: error instanceof Error ? error.message : 'Failed to replay request.' };
    }
};

const handlePruneAction = async (hostname: string): Promise<FlashMessage> => {
    try {
        const deleted = await deleteRequestLogsByHostname(hostname);
        return {
            success: deleted > 0 ? `Deleted ${deleted} log(s) for ${hostname}.` : 'No logs to prune for this host.'
        };
    } catch (error) {
        console.error('Failed to prune logs for host:', error);
        return { error: 'Unable to prune logs right now.' };
    }
};

const requestLogsDashboard = async (request: Request, response: Response): Promise<void> => {
    const hostHeader = request.headers.host;

    if (!hostHeader) {
        response.status(400).send('Host header required to view logs.');
        return;
    }

    let hostname: string;

    try {
        hostname = new URL('https://' + hostHeader).hostname;
    } catch (error) {
        response.status(400).send('Invalid host header.');
        return;
    }

    await pruneRequestLogsOlderThanDays(14).catch((error) => {
        console.error('Failed to prune stale logs:', error);
    });

    const storedPassword = await getRequestLogPassword(hostname);

    if (!storedPassword) {
        response.status(404).send('No log password provisioned for this host yet. Connect a tunnel first.');
        return;
    }

    const formData = request.method === 'POST' ? formDataFromRequest(request) : undefined;
    const providedPassword = resolveRequestPassword(request, formData);

    if (!providedPassword) {
        response.status(401).send('Log password required. Append ?token=PASSWORD or provide a Bearer token.');
        return;
    }

    if (providedPassword !== storedPassword) {
        response.status(401).send('Invalid log password for this host.');
        return;
    }

    let flash: FlashMessage | undefined;

    if (request.method === 'POST') {
        if (!formData) {
            response.status(400).send('Malformed form submission.');
            return;
        }

        const action = formData.get('action');

        if (action === 'prune') {
            flash = await handlePruneAction(hostname);
        } else if (action === 'replay') {
            const logId = Number(formData.get('logId'));
            flash = await handleReplayAction(hostname, logId);
        } else {
            flash = { error: 'Unknown action requested.' };
        }
    }

    const logs = await findRecentRequestLogsByHostname(hostname);
    response.header('Content-Type', 'text/html; charset=utf-8');
    response.send(renderPage(hostname, logs, flash, storedPassword));
};

export default requestLogsDashboard;
