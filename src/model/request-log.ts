export interface RequestLog {
    id?: number;
    hostname: string;
    path: string;
    method: string;
    requestHeaders: Record<string, any>;
    requestBody: string;
    responseStatus?: number;
    responseHeaders: Record<string, any>;
    responseBody: string;
    createdAt?: string;
}

export interface CreateRequestLogInput {
    hostname: string;
    path: string;
    method: string;
    requestHeaders: Record<string, any>;
    requestBody: string;
    responseStatus?: number;
    responseHeaders: Record<string, any>;
    responseBody: string;
}
