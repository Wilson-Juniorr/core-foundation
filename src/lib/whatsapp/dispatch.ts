export type DispatchCheck = () => Promise<boolean>;

export class WhatsAppDispatchCancelled extends Error {
  constructor() {
    super("O contexto mudou antes do envio.");
    this.name = "WhatsAppDispatchCancelled";
  }
}
