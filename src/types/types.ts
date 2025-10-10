export type ChatMessage = {
    id: string;
    author: string;
    ts: number;
    text?: string;
    cid?: string;
}