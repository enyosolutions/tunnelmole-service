import { runPreparedStatement } from "../mysql/run-prepared-statement";
import { CreateRequestLogInput, RequestLog } from "../model/request-log";

const REQUEST_LOGS_TABLE = 'request_logs';
const MS_PER_DAY = 86400000;

const serializePayload = (payload: Record<string, any>): string => JSON.stringify(payload ?? {});

const safeParse = (value?: string | null): Record<string, any> => {
    if (!value) {
        return {};
    }

    try {
        return JSON.parse(value);
    } catch (error) {
        console.error('Failed to parse request log payload:', error);
        return {};
    }
};

const toMysqlDateTime = (date: Date): string => {
    const pad = (num: number) => num.toString().padStart(2, '0');
    const year = date.getUTCFullYear();
    const month = pad(date.getUTCMonth() + 1);
    const day = pad(date.getUTCDate());
    const hours = pad(date.getUTCHours());
    const minutes = pad(date.getUTCMinutes());
    const seconds = pad(date.getUTCSeconds());

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
};

const mapRowToRequestLog = (row: any): RequestLog => ({
    id: row.id,
    hostname: row.hostname,
    path: row.path,
    method: row.method,
    requestHeaders: safeParse(row.request_headers),
    requestBody: row.request_body ?? '',
    responseStatus: row.response_status ?? undefined,
    responseHeaders: safeParse(row.response_headers),
    responseBody: row.response_body ?? '',
    createdAt: row.created_at
});

const createRequestLog = async (input: CreateRequestLogInput): Promise<void> => {
    await runPreparedStatement(
        `
        INSERT INTO ${REQUEST_LOGS_TABLE} (
            hostname,
            path,
            method,
            request_headers,
            request_body,
            response_status,
            response_headers,
            response_body
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
            input.hostname,
            input.path,
            input.method,
            serializePayload(input.requestHeaders),
            input.requestBody,
            input.responseStatus ?? null,
            serializePayload(input.responseHeaders),
            input.responseBody
        ]
    );
};

const findRecentRequestLogsByHostname = async (hostname: string, limit = 50): Promise<RequestLog[]> => {
    const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 200) : 50;

    const [rows]: any = await runPreparedStatement(
        `
        SELECT id, hostname, path, method, request_headers, request_body, response_status, response_headers, response_body, created_at
        FROM ${REQUEST_LOGS_TABLE}
        WHERE hostname = ?
        ORDER BY created_at DESC, id DESC
        LIMIT ${safeLimit}
        `,
        [hostname]
    );

    return rows.map(mapRowToRequestLog);
};

const findRequestLogById = async (id: number): Promise<RequestLog | undefined> => {
    const [rows]: any = await runPreparedStatement(
        `
        SELECT id, hostname, path, method, request_headers, request_body, response_status, response_headers, response_body, created_at
        FROM ${REQUEST_LOGS_TABLE}
        WHERE id = ?
        LIMIT 1
        `,
        [id]
    );

    if (!rows || rows.length === 0) {
        return undefined;
    }

    return mapRowToRequestLog(rows[0]);
};

const deleteRequestLogsByHostname = async (hostname: string): Promise<number> => {
    const [result]: any = await runPreparedStatement(
        `
        DELETE FROM ${REQUEST_LOGS_TABLE}
        WHERE hostname = ?
        `,
        [hostname]
    );

    return result?.affectedRows ?? 0;
};

const pruneRequestLogsOlderThanDays = async (days = 14): Promise<number> => {
    const threshold = new Date(Date.now() - days * MS_PER_DAY);
    const cutoff = toMysqlDateTime(threshold);

    const [result]: any = await runPreparedStatement(
        `
        DELETE FROM ${REQUEST_LOGS_TABLE}
        WHERE created_at < ?
        `,
        [cutoff]
    );

    return result?.affectedRows ?? 0;
};

export {
    createRequestLog,
    findRecentRequestLogsByHostname,
    findRequestLogById,
    deleteRequestLogsByHostname,
    pruneRequestLogsOlderThanDays
};
