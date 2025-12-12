export default interface ForwardedResponseStreamStartMessage {
    type: 'forwardedResponseStreamStart';
    requestId: string;
    url: string;
    statusCode: number;
    headers: Record<string, any>;
}
