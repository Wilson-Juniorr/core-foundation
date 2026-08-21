import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Entrar — Próximo Passo" },
      {
        name: "description",
        content: "Acesse sua conta do Próximo Passo para acompanhar clientes e oportunidades.",
      },
      { property: "og:title", content: "Entrar — Próximo Passo" },
      {
        property: "og:description",
        content: "Acesse sua conta do Próximo Passo para acompanhar clientes e oportunidades.",
      },
    ],
  }),
  component: AuthPage,
});

function friendlyAuthError(message: string): string {
  if (/invalid login credentials/i.test(message)) return "E-mail ou senha incorretos.";
  if (/email not confirmed/i.test(message)) return "Confirme seu e-mail antes de entrar.";
  if (/already registered/i.test(message)) return "Este e-mail já possui conta. Faça login.";
  if (/weak|pwned/i.test(message))
    return "Esta senha é muito comum e já apareceu em vazamentos. Escolha outra.";
  if (/invalid.*email/i.test(message)) return "Informe um e-mail válido.";
  if (/password/i.test(message) && /6/.test(message))
    return "A senha deve ter no mínimo 6 caracteres.";
  if (/rate limit|too many/i.test(message))
    return "Muitas tentativas. Aguarde alguns instantes e tente novamente.";
  return "Não foi possível concluir a operação. Tente novamente.";
}

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setSubmitting(true);

    try {
      if (mode === "login") {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) {
          setError(friendlyAuthError(signInError.message));
          return;
        }
        navigate({ to: "/dashboard", replace: true });
        return;
      }

      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${window.location.origin}/dashboard` },
      });
      if (signUpError) {
        setError(friendlyAuthError(signUpError.message));
        return;
      }
      if (data.session) {
        navigate({ to: "/dashboard", replace: true });
        return;
      }
      setNotice("Conta criada. Verifique seu e-mail para confirmar o acesso.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-sm">
        <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
          ← Voltar
        </Link>
        <h1 className="mt-6 text-2xl font-semibold">Próximo Passo</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Entre para acompanhar seus clientes e oportunidades.
        </p>

        <Tabs
          value={mode}
          onValueChange={(value) => {
            setMode(value as "login" | "signup");
            setError(null);
            setNotice(null);
          }}
          className="mt-8"
        >
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="login">Entrar</TabsTrigger>
            <TabsTrigger value="signup">Criar conta</TabsTrigger>
          </TabsList>

          <TabsContent value={mode} className="mt-6">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">E-mail</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Senha</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  required
                  minLength={6}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>

              {error ? <p className="text-sm text-destructive">{error}</p> : null}
              {notice ? <p className="text-sm text-muted-foreground">{notice}</p> : null}

              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? "Aguarde…" : mode === "login" ? "Entrar" : "Criar conta"}
              </Button>
            </form>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
