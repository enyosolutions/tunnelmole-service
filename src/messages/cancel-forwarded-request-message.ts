export default interface CancelForwardedRequestMessage {
    type: 'cancelForwardedRequest';
    requestId: string;
}
