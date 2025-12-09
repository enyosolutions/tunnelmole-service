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

interface RenderedLogEntry {
    summary: string;
    detail: string;
}

const methodClassName = (method: string): string => {
    const normalized = method.toLowerCase();
    if (normalized === 'get') {
        return 'method-get';
    }
    if (normalized === 'post') {
        return 'method-post';
    }
    if (normalized === 'put') {
        return 'method-put';
    }
    if (normalized === 'patch') {
        return 'method-patch';
    }
    if (normalized === 'delete') {
        return 'method-delete';
    }
    if (normalized === 'options') {
        return 'method-options';
    }
    if (normalized === 'head') {
        return 'method-head';
    }
    return 'method-default';
};

const renderEntry = (log: RequestLog, token?: string): RenderedLogEntry => {
    const createdAt = log.createdAt ? new Date(log.createdAt).toLocaleString('fr-FR') : 'Unknown time';
    const headersSection = htmlEscape(formatJson(log.requestHeaders));
    const responseHeadersSection = htmlEscape(formatJson(log.responseHeaders));
    const tokenInput = token ? `<input type="hidden" name="token" value="${htmlEscape(token)}" />` : '';
    const detailsId = typeof log.id !== 'undefined' ? `log-details-${log.id}` : `log-details-${nanoid(8)}`;
    const methodClasses = `method ${methodClassName(log.method ?? '')}`;

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

    const summary = `
        <li class="log-summary" data-details-id="${detailsId}">
            <span class="${methodClasses}">${htmlEscape(log.method)}</span>
            <span class="path">${htmlEscape(log.path)}</span>
            <span class="status ${log.responseStatus && log.responseStatus >= 400 ? 'status-error' : ''}">${log.responseStatus ?? '—'}</span>
            <span class="timestamp">${htmlEscape(createdAt)}</span>
        </li>
    `;

    const detail = `
        <article id="${detailsId}" class="log-detail" hidden>
            <header>
                <div>
                    <h2><span class="${methodClasses}">${htmlEscape(log.method)}</span> <span class="path">${htmlEscape(log.path)}</span></h2>
                    <p class="timestamp">${htmlEscape(createdAt)}</p>
                </div>
                <div class="actions">
                    <span class="status ${log.responseStatus && log.responseStatus >= 400 ? 'status-error' : ''}">${log.responseStatus ?? '—'}</span>
                    ${replayButton}
                </div>
            </header>
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
        </article>
    `;

    return { summary, detail };
};

const renderPage = (hostname: string, logs: RequestLog[], flash?: FlashMessage, token?: string): string => {
    const renderedEntries = logs.map((log) => renderEntry(log, token));
    const summaries = renderedEntries.map((entry) => entry.summary).join('\n');
    const detailPanels = renderedEntries.map((entry) => entry.detail).join('\n');

    const entries = logs.length > 0
        ? `
            <div class="logs-layout" data-has-logs="true">
                <aside class="logs-sidebar">
                    <ul id="log-summaries">
                        ${summaries}
                    </ul>
                </aside>
                <section class="log-detail-panel">
                    <div id="log-detail-container">
                        ${detailPanels}
                    </div>
                </section>
            </div>
        `
        : '<p class="muted">No requests logged for this endpoint yet.</p>';

    const flashMarkup = renderFlash(flash);
    const tokenInput = token ? `<input type="hidden" name="token" value="${htmlEscape(token)}" />` : '';
    return `
        <!doctype html>
        <html lang="en">
        <head>
            <meta charset="utf-8" />
            <title>Request Logs for ${htmlEscape(hostname)}</title>
            <style>
                body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background-color: #111827; color: #e6edf3; margin: 0; padding: 2rem; }
                h1 { margin-top: 0; font-size: 1.5rem; }
                .page-header { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 1rem; margin-bottom: 1rem; }
                .page-header .toolbar { margin-left: auto; }
                .muted { color: #8b949e; }
                .logs-layout { display: grid; grid-template-columns: 320px 1fr; gap: 1rem; }
                .logs-sidebar { background: #1b2432; border: 1px solid #30363d; border-radius: 8px; overflow: hidden; }
                #log-summaries { list-style: none; margin: 0; padding: 0; }
                .log-summary { display: grid; grid-template-columns: auto 1fr auto; gap: 0.5rem; padding: 0.75rem 1rem; cursor: pointer; border-bottom: 1px solid #30363d; align-items: baseline; }
                .log-summary:last-child { border-bottom: none; }
                .log-summary .path { font-family: monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
                .log-summary .timestamp { font-size: 0.8rem; color: #8b949e; grid-column: 1 / -1; }
                .log-summary.active { background: #2d3748; }
                .log-detail-panel { margin-top: 0; margin-bottom: 0; background: #1f2937; border: 1px solid #30363d; border-radius: 8px; padding: 1rem; min-height: 400px; }
                .log-detail header { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 0.5rem; }
                .log-detail h2 { margin: 0; }
                .method { font-weight: 600; margin-right: 0.25rem; padding: 0.5rem 0.5rem; border-radius: 5px; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.04em; display: inline-block; background: #374151; color: #e6edf3; }
                .method-get { background: #22c55e; color: #fff; }
                .method-post { background: #3b82f6; color: #ffffff; }
                .method-put { background: #f59e0b; color: #ffffff; }
                .method-patch { background: #a855f7; color: #ffffff; }
                .method-delete { background: #ef4444; color: #ffffff; }
                .method-options { background:rgb(14, 29, 233); color: #ffffff; }
                .method-head { background: #94a3b8; color: #111827; }
                .method-default { background: #4b5563; color: #e6edf3; }
                .path { font-family: monospace; }
                .status { font-weight: 600; }
                .status-error { color: #f85149; }
                .timestamp { font-size: 0.9rem; color: #8b949e; margin: 0; }
                pre { background: #161d28; border: 1px solid #30363d; border-radius: 6px; padding: 0.75rem; overflow-x: auto; }
                section { margin: 0.5rem 0; }
                form.toolbar { margin: 0; }
                form.inline-form { display: inline-block; }
                .btn { background: #238636; border: 1px solid #2ea043; color: #fff; padding: 0.35rem 0.75rem; border-radius: 6px; cursor: pointer; font-size: 0.85rem; }
                .btn:hover { background: #2ea043; }
                .actions { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; }
                .flash { padding: 0.75rem 1rem; border-radius: 6px; margin-bottom: 1rem; }
                .flash-success { background: #1f6feb33; border: 1px solid #1f6feb; }
                .flash-error { background: #f8514933; border: 1px solid #f85149; }
            </style>
            <script>
                const LOG_CONTAINER_ID = 'log-entries';
                const POLL_INTERVAL_MS = 5000;
                let isRefreshingLogs = false;

                const activateLogDetails = (detailsId) => {
                    if (!detailsId) {
                        return false;
                    }

                    let activated = false;
                    const detailPanels = document.querySelectorAll('.log-detail');
                    detailPanels.forEach((panel) => {
                        if (panel.id === detailsId) {
                            panel.removeAttribute('hidden');
                            activated = true;
                        } else {
                            panel.setAttribute('hidden', 'true');
                        }
                    });

                    const summaries = document.querySelectorAll('.log-summary');
                    summaries.forEach((summary) => {
                        const summaryDetailsId = summary.getAttribute('data-details-id');
                        summary.classList.toggle('active', summaryDetailsId === detailsId);
                    });

                    return activated;
                };

                const activateFirstLog = () => {
                    const firstSummary = document.querySelector('.log-summary');
                    if (!firstSummary) {
                        const detailPanels = document.querySelectorAll('.log-detail');
                        detailPanels.forEach((panel) => panel.setAttribute('hidden', 'true'));
                        return;
                    }
                    const detailsId = firstSummary.getAttribute('data-details-id');
                    if (detailsId) {
                        activateLogDetails(detailsId);
                    }
                };

                const getActiveDetailsId = () => {
                    const activeSummary = document.querySelector('.log-summary.active');
                    return activeSummary ? activeSummary.getAttribute('data-details-id') : undefined;
                };

                const restoreActiveDetails = (detailsId) => {
                    if (!detailsId) {
                        activateFirstLog();
                        return;
                    }
                    if (!activateLogDetails(detailsId)) {
                        activateFirstLog();
                    }
                };

                const refreshLogs = async () => {
                    if (isRefreshingLogs || document.hidden) {
                        return;
                    }
                    const container = document.getElementById(LOG_CONTAINER_ID);
                    if (!container) {
                        return;
                    }

                    const activeDetailsId = getActiveDetailsId();
                    isRefreshingLogs = true;

                    try {
                        const response = await fetch(window.location.href, {
                            headers: { 'X-Requested-With': 'XMLHttpRequest' },
                            cache: 'no-cache'
                        });
                        if (!response.ok) {
                            return;
                        }
                        const text = await response.text();
                        const parser = new DOMParser();
                        const doc = parser.parseFromString(text, 'text/html');
                        const updatedContainer = doc.getElementById(LOG_CONTAINER_ID);
                        if (!updatedContainer) {
                            return;
                        }
                        if (container.innerHTML === updatedContainer.innerHTML) {
                            return;
                        }
                        container.innerHTML = updatedContainer.innerHTML;
                        restoreActiveDetails(activeDetailsId);
                    } catch (error) {
                        console.error('Failed to refresh request logs:', error);
                    } finally {
                        isRefreshingLogs = false;
                    }
                };

                const startLogPolling = () => {
                    activateFirstLog();
                    setInterval(refreshLogs, POLL_INTERVAL_MS);
                };

                document.addEventListener('click', (event) => {
                    const rawTarget = event.target;
                    if (!(rawTarget instanceof HTMLElement)) {
                        return;
                    }

                    const summary = rawTarget.closest('.log-summary');
                    if (!summary) {
                        return;
                    }

                    event.preventDefault();
                    const detailsId = summary.getAttribute('data-details-id');
                    activateLogDetails(detailsId);
                });

                document.addEventListener('DOMContentLoaded', startLogPolling);
            </script>
        </head>
        <body>
            <div class="page-header">
                <h1>Request Logs for ${htmlEscape(hostname)}</h1>
                <form method="post" class="toolbar">
                    <input type="hidden" name="action" value="prune" />
                    ${tokenInput}
                    <button type="submit" class="btn">Prune All Logs For This Host</button>
                </form>
            </div>
            ${flashMarkup}
            <div id="log-entries">
                ${entries}
            </div>
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
