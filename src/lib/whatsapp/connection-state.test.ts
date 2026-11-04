import { describe, expect, it } from "vitest";
import {
  DISCONNECTED_USER_MESSAGE,
  isDisconnectedMessage,
  isDisconnectedReply,
  mapConnectionStatus,
  sessionFlagsSayOffline,
} from "./connection-state";

describe("status da conexão do WhatsApp", () => {
  it("'disconnected' nunca é lido como conectado", () => {
    expect(mapConnectionStatus("disconnected")).toBe("disconnected");
    expect(mapConnectionStatus("DISCONNECTED")).toBe("disconnected");
  });

  it("'connected' é conectado", () => {
    expect(mapConnectionStatus("connected")).toBe("connected");
    expect(mapConnectionStatus("open")).toBe("connected");
  });

  it("flags connected:false ou loggedIn:false indicam sessão fora", () => {
    expect(sessionFlagsSayOffline({ status: { connected: false, loggedIn: false } })).toBe(true);
    expect(sessionFlagsSayOffline({ status: { connected: true, loggedIn: true } })).toBe(false);
  });

  it("resposta 503 'WhatsApp disconnected' do envio é desconexão", () => {
    expect(
      isDisconnectedReply(
        503,
        '{"error":true,"message":"WhatsApp disconnected: session is not reconnectable"}',
      ),
    ).toBe(true);
    expect(isDisconnectedReply(500, '{"error":"invalid file"}')).toBe(false);
  });

  it("a mensagem de desconexão é reconhecida pelo motor", () => {
    expect(isDisconnectedMessage(DISCONNECTED_USER_MESSAGE)).toBe(true);
    expect(
      isDisconnectedMessage(
        "O provedor de WhatsApp respondeu com erro. Tente novamente em instantes.",
      ),
    ).toBe(false);
  });
});
