import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { contactsQuery } from "@/lib/crm.queries";
import { formatPhone } from "@/lib/domain/phone";

/**
 * Busca global: encontrar um cliente por nome ou telefone de qualquer tela é o
 * atalho mais usado no dia a dia. Atalho de teclado: "/".
 */
export function GlobalSearch() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(term.trim()), 300);
    return () => clearTimeout(timer);
  }, [term]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable === true;
      if (event.key === "/" && !typing) {
        event.preventDefault();
        setOpen(true);
        requestAnimationFrame(() => inputRef.current?.focus());
      }
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const results = useQuery({
    ...contactsQuery(debounced, true),
    enabled: open && debounced.length >= 2,
  });
  const contacts = (results.data ?? []).slice(0, 8);

  if (!open) {
    return (
      <Button
        variant="ghost"
        size="icon"
        aria-label="Buscar cliente"
        title="Buscar cliente (tecla /)"
        onClick={() => {
          setOpen(true);
          requestAnimationFrame(() => inputRef.current?.focus());
        }}
      >
        <Search className="size-4" aria-hidden />
      </Button>
    );
  }

  return (
    <div className="relative">
      <div className="flex items-center gap-1">
        <div className="relative">
          <Search
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
            aria-hidden
          />
          <Input
            ref={inputRef}
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Buscar cliente por nome ou telefone"
            aria-label="Buscar cliente"
            className="w-52 pl-9 sm:w-72"
          />
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Fechar busca"
          onClick={() => {
            setOpen(false);
            setTerm("");
          }}
        >
          <X className="size-4" aria-hidden />
        </Button>
      </div>

      {debounced.length >= 2 && (
        <div className="bg-popover absolute right-0 z-50 mt-2 w-72 overflow-hidden rounded-md border shadow-md sm:w-80">
          {results.isPending ? (
            <p className="text-muted-foreground p-3 text-sm">Buscando…</p>
          ) : contacts.length === 0 ? (
            <p className="text-muted-foreground p-3 text-sm">Nenhum cliente encontrado.</p>
          ) : (
            <ul className="max-h-72 overflow-y-auto">
              {contacts.map((contact) => (
                <li key={contact.id}>
                  <button
                    type="button"
                    className="hover:bg-muted/60 flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left"
                    onClick={() => {
                      setOpen(false);
                      setTerm("");
                      navigate({
                        to: "/clientes/$contactId",
                        params: { contactId: contact.id },
                      });
                    }}
                  >
                    <span className="w-full truncate text-sm font-medium">{contact.name}</span>
                    <span className="text-muted-foreground w-full truncate text-xs">
                      {formatPhone(contact.phone) || contact.email || "Sem contato registrado"}
                      {contact.is_archived ? " · arquivado" : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
