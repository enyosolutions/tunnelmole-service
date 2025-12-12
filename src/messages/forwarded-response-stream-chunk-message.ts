export default interface ForwardedResponseStreamChunkMessage {
    type: 'forwardedResponseStreamChunk';
    requestId: string;
    url: string;
    body: string; // Base64 encoded chunk
    isFinal?: boolean;
}
