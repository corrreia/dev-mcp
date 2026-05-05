import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowUpRight,
  Cable,
  CheckCircle2,
  Copy,
  Database,
  Loader2,
  Plus,
  Power,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  Trash2,
  TriangleAlert
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  createSourceConfig,
  deleteSourceConfig,
  getDashboardData,
  refreshSourceConfig,
  searchCombinedCatalog,
  setSourceEnabledConfig
} from "@/server/functions/sources";
import type { SearchResult, SourceAuthType, SourceConfig, SourceType } from "@/types";

interface SessionResponse {
  authenticated: boolean;
  user: null | { id: string; email?: string; name?: string; image?: string };
}

interface DashboardData {
  session: SessionResponse;
  sources: SourceConfig[];
  stats: { openapiEndpoints: number; mcpTools: number; enabledSources: number };
}

interface SourceInput {
  slug: string;
  type: SourceType;
  name?: string;
  baseUrl?: string;
  specUrl?: string;
  authType: SourceAuthType;
  authHeaderName?: string;
  secret?: string;
}

const RULE = "─".repeat(120);

export function Dashboard({ initialData }: { initialData: DashboardData }) {
  const [session, setSession] = useState(initialData.session);
  const [sources, setSources] = useState(initialData.sources);
  const [stats, setStats] = useState(initialData.stats);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [mcpEndpoint, setMcpEndpoint] = useState("/mcp");
  const [now, setNow] = useState<string>("");

  const loadDashboard = useServerFn(getDashboardData);
  const deleteSource = useServerFn(deleteSourceConfig);
  const refreshSource = useServerFn(refreshSourceConfig);
  const searchCatalog = useServerFn(searchCombinedCatalog);
  const updateSourceEnabled = useServerFn(setSourceEnabledConfig);

  useEffect(() => {
    setMcpEndpoint(`${window.location.origin}/mcp`);
    const tick = () => {
      const d = new Date();
      const iso = d.toISOString().replace("T", " ").slice(0, 19);
      setNow(`${iso} UTC`);
    };
    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!initialData.session.authenticated) return;
    void refreshSearch("");
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!event.data || typeof event.data !== "object") return;
      if ((event.data as { type?: unknown }).type !== "dev-mcp:oauth-complete") return;
      toast.success("OAuth source connected.");
      void load();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  async function refreshSearch(searchQuery = query) {
    setSearchResults(await searchCatalog({ data: { query: searchQuery } }));
  }

  async function load() {
    setError("");
    setLoading(true);
    try {
      const data = await loadDashboard();
      setSession(data.session);
      setSources(data.sources);
      setStats(data.stats);
      if (data.session.authenticated) await refreshSearch();
    } catch (err) {
      setError(formatError(err));
    } finally {
      setLoading(false);
    }
  }

  async function onRefresh(slug: string) {
    setStatus("");
    setError("");
    const toastId = toast.loading(`refreshing ${slug}…`);
    try {
      const result = await refreshSource({ data: { slug } });
      const message = `Indexed ${result.count} catalog items from ${slug}.`;
      setStatus(message);
      const data = await loadDashboard();
      setSources(data.sources);
      setStats(data.stats);
      await refreshSearch();
      toast.success(message, { id: toastId });
    } catch (err) {
      const message = formatError(err);
      setError(message);
      toast.error(message, { id: toastId });
    }
  }

  async function onSearch(event: FormEvent) {
    event.preventDefault();
    setError("");
    setStatus("");
    try {
      await refreshSearch();
    } catch (err) {
      setError(formatError(err));
    }
  }

  async function onDelete(slug: string) {
    setError("");
    try {
      await deleteSource({ data: { slug } });
      const data = await loadDashboard();
      setSources(data.sources);
      setStats(data.stats);
      await refreshSearch();
      toast.success(`Deleted ${slug}.`);
    } catch (err) {
      setError(formatError(err));
    }
  }

  async function onSourceEnabledChange(slug: string, enabled: boolean) {
    setError("");
    try {
      await updateSourceEnabled({ data: { slug, enabled } });
      const data = await loadDashboard();
      setSources(data.sources);
      setStats(data.stats);
      await refreshSearch();
    } catch (err) {
      setError(formatError(err));
    }
  }

  const counts = useMemo(
    () => ({
      total: sources.length,
      openapi: sources.filter((source) => source.type === "openapi").length,
      mcp: sources.filter((source) => source.type === "mcp").length
    }),
    [sources]
  );

  if (loading) return <LoadingView />;
  if (!session.authenticated) return <AuthGate error={error} />;

  const userLabel = session.user?.email ?? session.user?.name ?? "operator";

  return (
    <main className="min-h-svh px-5 pb-24 pt-6 md:px-10 md:pt-10">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-12 stagger-fade">
        <TopBar userLabel={userLabel} now={now} />

        <Hero />

        <EndpointPanel endpoint={mcpEndpoint} />

        <section className="grid gap-px bg-hairline md:grid-cols-3">
          <Metric index="01" icon={<Server className="size-4" />} label="Sources" value={counts.total} sublabel={`${stats.enabledSources} enabled`} accent />
          <Metric index="02" icon={<Database className="size-4" />} label="OpenAPI" value={counts.openapi} sublabel={`${stats.openapiEndpoints} endpoints`} />
          <Metric index="03" icon={<Cable className="size-4" />} label="MCP" value={counts.mcp} sublabel={`${stats.mcpTools} tools`} />
        </section>

        {status ? <SuccessAlert message={status} /> : null}
        {error ? <ErrorAlert message={error} /> : null}

        <Section
          numeral="// 04"
          title="Register a source"
          subtitle="OpenAPI specs become callable APIs. MCP servers become upstream tool sets."
        >
          <SourceForm
            onCreated={async () => {
              const data = await loadDashboard();
              setSources(data.sources);
              setStats(data.stats);
              await refreshSearch();
              toast.success("source added.");
            }}
            onError={setError}
          />
        </Section>

        <Section
          numeral="// 05"
          title="Catalog"
          subtitle="Refresh sources to update what Code Mode can search and execute."
          actions={
            <Button
              type="button"
              onClick={() => void load()}
              variant="outline"
              size="sm"
              className="group rounded-none border-hairline-strong bg-transparent font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground hover:border-acid hover:bg-acid hover:text-primary-foreground"
            >
              <RefreshCw className="size-3 transition-transform group-hover:rotate-180" />
              reload
            </Button>
          }
        >
          <SourcesTable sources={sources} onRefresh={onRefresh} onDelete={onDelete} onToggleEnabled={onSourceEnabledChange} />

          <div className="mt-8 mb-6 ascii-divider">────── // QUERY ──────</div>

          <form className="flex flex-col gap-2 md:flex-row" onSubmit={onSearch}>
            <div className="relative flex-1">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 select-none text-acid">▸</span>
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="grep the combined catalog…"
                autoComplete="off"
                className="h-11 rounded-none border-hairline-strong bg-transparent pl-9 font-mono tracking-tight text-foreground focus-visible:border-acid focus-visible:ring-0"
              />
            </div>
            <Button
              type="submit"
              className="h-11 rounded-none border-acid bg-acid px-5 font-mono text-[11px] uppercase tracking-[0.22em] text-primary-foreground hover:border-foreground hover:bg-foreground"
            >
              <Search className="size-3.5" />
              search
            </Button>
          </form>

          <div className="mt-6">
            <SearchResultsTable results={searchResults} />
          </div>
        </Section>

        <Footer />
      </div>
    </main>
  );
}

/* ────────────────────────────────────────────────────────────── */

function TopBar({ userLabel, now }: { userLabel: string; now: string }) {
  return (
    <div className="flex flex-col items-start justify-between gap-3 border-b border-hairline pb-3 md:flex-row md:items-center">
      <div className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
        <span className="diode" aria-hidden />
        <span>operational</span>
        <span className="text-hairline-strong">·</span>
        <span className="text-foreground/70">{now || "—"}</span>
      </div>
      <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
        <span className="text-foreground/70">{userLabel}</span>
        <span className="text-hairline-strong">/</span>
        <Button
          type="button"
          onClick={() => void logout()}
          variant="link"
          size="sm"
          className="h-auto rounded-none border-b border-transparent px-0 pb-px font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground hover:border-acid hover:text-acid hover:no-underline"
        >
          sign out ↗
        </Button>
      </div>
    </div>
  );
}

function Hero() {
  return (
    <header className="grid gap-8 md:grid-cols-[1fr_auto] md:items-end">
      <div>
        <div className="mb-4 flex items-center gap-3">
          <span className="label-tag">[ mcp × openapi gateway ]</span>
          <span className="hairline w-12" />
        </div>
        <h1 className="font-display text-[clamp(3.5rem,11vw,8rem)] leading-[0.9] tracking-tight text-foreground">
          <span className="italic">dev</span>
          <span className="text-acid acid-glow">/</span>
          <span>mcp</span>
        </h1>
        <p className="mt-6 max-w-xl font-mono text-sm leading-relaxed text-muted-foreground">
          A single authenticated endpoint that fans out across every MCP server and OpenAPI spec
          you register. Code Mode searches the combined surface, then executes.
        </p>
      </div>
      <div className="hidden flex-col items-end gap-2 md:flex">
        <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground">v 0.1</div>
        <div className="font-display text-5xl italic text-foreground/40">→</div>
        <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground">cf workers</div>
      </div>
    </header>
  );
}

function EndpointPanel({ endpoint }: { endpoint: string }) {
  const [copied, setCopied] = useState(false);

  function copy() {
    void navigator.clipboard.writeText(endpoint).then(() => {
      setCopied(true);
      toast.success("endpoint copied.");
      window.setTimeout(() => setCopied(false), 1400);
    });
  }

  return (
    <div className="frame frame-corner relative scan-line p-6 md:p-7">
      <span className="corner-tl" />
      <span className="corner-tr" />
      <span className="corner-bl" />
      <span className="corner-br" />
      <div className="flex flex-col gap-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ShieldCheck className="size-4 text-acid" />
            <span className="label-tag">authenticated mcp endpoint</span>
          </div>
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            <span className="diode" aria-hidden />
            <span>online</span>
          </div>
        </div>

        <div className="group flex items-center gap-3 border border-dashed border-hairline-strong bg-background/60 px-4 py-3.5">
          <span className="select-none font-mono text-acid">$</span>
          <code className="flex-1 truncate font-mono text-sm text-foreground/90 md:text-base">
            {endpoint}
            <span className="terminal-cursor" />
          </code>
          <Button
            type="button"
            onClick={copy}
            variant="outline"
            size="xs"
            className="shrink-0 rounded-none border-hairline-strong font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground hover:border-acid hover:bg-acid hover:text-primary-foreground"
          >
            {copied ? <CheckCircle2 className="size-3" /> : <Copy className="size-3" />}
            {copied ? "ok" : "copy"}
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          <span className="text-foreground">→ search</span>
          <span className="text-foreground">→ execute</span>
          <span className="text-acid">▸ dynamic-workers</span>
          <span>· code-mode ready</span>
        </div>
      </div>
    </div>
  );
}

function Metric({
  index,
  icon,
  label,
  value,
  sublabel,
  accent
}: {
  index: string;
  icon: ReactNode;
  label: string;
  value: number;
  sublabel?: string;
  accent?: boolean;
}) {
  return (
    <div className="group relative flex items-end justify-between gap-4 bg-card p-6 transition-colors hover:bg-card/70">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 label-tag">
          <span className="text-acid">{index}</span>
          <span>{label}</span>
        </div>
        <div
          className={`font-display text-7xl leading-none tracking-tight tabular-nums ${
            accent ? "text-acid acid-glow" : "text-foreground"
          }`}
        >
          {String(value).padStart(2, "0")}
        </div>
        {sublabel ? (
          <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            {sublabel}
          </div>
        ) : null}
      </div>
      <div className="flex size-9 items-center justify-center border border-hairline-strong text-muted-foreground transition-colors group-hover:border-acid group-hover:text-acid">
        {icon}
      </div>
    </div>
  );
}

function Section({
  numeral,
  title,
  subtitle,
  actions,
  children
}: {
  numeral: string;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="border-t border-hairline pt-10">
      <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="label-tag mb-3 text-acid">{numeral}</div>
          <h2 className="font-display text-4xl italic leading-tight tracking-tight text-foreground md:text-5xl">
            {title}
          </h2>
          {subtitle ? (
            <p className="mt-2 max-w-xl font-mono text-sm text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

/* ────────────────────────────────────────────────────────────── */

function SourcesTable({
  sources,
  onRefresh,
  onDelete,
  onToggleEnabled
}: {
  sources: SourceConfig[];
  onRefresh: (slug: string) => Promise<void>;
  onDelete: (slug: string) => Promise<void>;
  onToggleEnabled: (slug: string, enabled: boolean) => Promise<void>;
}) {
  if (sources.length === 0) {
    return (
      <Empty
        title="no sources"
        description="register an openapi spec or mcp server to start combining tools."
      />
    );
  }

  return (
    <div className="overflow-x-auto border border-hairline">
      <div className="grid min-w-[52rem] grid-cols-[2.4rem_minmax(0,1fr)_5rem_5rem_7rem_5rem] items-center gap-3 border-b border-hairline bg-background/40 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
        <span>#</span>
        <span>source</span>
        <span>type</span>
        <span>auth</span>
        <span>status</span>
        <span className="text-right">actions</span>
      </div>
      {sources.map((source, idx) => (
        <div
          key={source.id}
          className="group grid min-w-[52rem] grid-cols-[2.4rem_minmax(0,1fr)_5rem_5rem_7rem_5rem] items-center gap-3 border-b border-hairline px-4 py-3 transition-colors last:border-b-0 hover:bg-card/60"
        >
          <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
            {String(idx + 1).padStart(2, "0")}
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="diode shrink-0" aria-hidden />
              <span className="truncate font-mono text-sm text-foreground">{source.name}</span>
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                /{source.slug}
              </span>
            </div>
            <p className="mt-0.5 truncate pl-5 font-mono text-[11px] text-muted-foreground/80">
              {source.baseUrl}
            </p>
          </div>
          <span
            className={`font-mono text-[11px] uppercase tracking-[0.18em] ${
              source.type === "mcp" ? "text-acid" : "text-foreground/80"
            }`}
          >
            {source.type}
          </span>
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            {source.authType}
          </span>
          <SourceSwitch
            enabled={source.enabled}
            onChange={(enabled) => onToggleEnabled(source.slug, enabled)}
          />
          <div className="flex items-center justify-end gap-1.5">
            <IconAction
              label="refresh"
              onClick={() => void onRefresh(source.slug)}
              icon={<RefreshCw className="size-3.5" />}
            />
            <IconAction
              label="delete"
              onClick={() => void onDelete(source.slug)}
              icon={<Trash2 className="size-3.5" />}
              danger
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function IconAction({
  label,
  icon,
  onClick,
  danger
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <Button
      type="button"
      aria-label={label}
      onClick={onClick}
      variant={danger ? "destructive" : "outline"}
      size="icon-sm"
      className={`rounded-none border-hairline bg-transparent ${
        danger
          ? "text-muted-foreground hover:border-destructive hover:bg-destructive/10 hover:text-destructive"
          : "text-muted-foreground hover:border-acid hover:bg-acid hover:text-primary-foreground"
      }`}
    >
      {icon}
    </Button>
  );
}

function SourceSwitch({
  enabled,
  onChange
}: {
  enabled: boolean;
  onChange: (enabled: boolean) => Promise<void>;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      onClick={() => void onChange(!enabled)}
      className={`inline-flex h-8 w-[6.5rem] items-center justify-between border px-2 font-mono text-[10px] uppercase tracking-[0.16em] transition-colors ${
        enabled
          ? "border-acid bg-acid/10 text-acid hover:bg-acid hover:text-primary-foreground"
          : "border-hairline bg-transparent text-muted-foreground hover:border-foreground hover:text-foreground"
      }`}
    >
      <Power className="size-3" />
      {enabled ? "on" : "off"}
    </button>
  );
}

function SearchResultsTable({ results }: { results: SearchResult[] }) {
  if (results.length === 0) {
    return (
      <Empty
        title="no results"
        description="run a catalog search to inspect the combined surface."
      />
    );
  }

  return (
    <div className="overflow-x-auto border border-hairline">
      <div className="grid min-w-[48rem] grid-cols-[2.4rem_minmax(0,1fr)_7rem_minmax(14rem,22rem)] items-center gap-3 border-b border-hairline bg-background/40 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
        <span>#</span>
        <span>item</span>
        <span>kind</span>
        <span className="text-right">reference</span>
      </div>
      {results.map((result, index) => (
        <div
          key={`${result.source}-${result.operation}-${index}`}
          className="group grid min-w-[48rem] grid-cols-[2.4rem_minmax(0,1fr)_7rem_minmax(14rem,22rem)] items-center gap-3 border-b border-hairline px-4 py-3 transition-colors last:border-b-0 hover:bg-card/60"
        >
          <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
            {String(index + 1).padStart(2, "0")}
          </span>
          <div className="min-w-0">
            <p className="truncate font-mono text-sm text-foreground">{result.title}</p>
            {result.description ? (
              <p className="truncate font-mono text-[11px] text-muted-foreground/80">{result.description}</p>
            ) : null}
          </div>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {kindLabel(result.kind)}
          </span>
          <span className="min-w-0 truncate justify-self-end border border-hairline-strong bg-background/40 px-2 py-1 text-right font-mono text-[10px] uppercase tracking-[0.18em] text-acid">
            {result.source}.{result.operation}
          </span>
        </div>
      ))}
    </div>
  );
}

function kindLabel(kind: SearchResult["kind"]): string {
  if (kind === "openapi_operation") return "endpoint";
  return "tool";
}

/* ────────────────────────────────────────────────────────────── */

function SourceForm({
  onCreated,
  onError
}: {
  onCreated: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [type, setType] = useState<SourceType>("openapi");
  const [authType, setAuthType] = useState<SourceAuthType>("none");
  const [saving, setSaving] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const createSource = useServerFn(createSourceConfig);

  function fillExample(input: SourceInput) {
    setType(input.type);
    setAuthType(input.authType);
    window.setTimeout(() => {
      const form = formRef.current;
      if (!form) return;
      setFormValue(form, "slug", input.slug);
      setFormValue(form, "name", input.name);
      setFormValue(form, "baseUrl", input.baseUrl);
      setFormValue(form, "specUrl", input.specUrl);
      setFormValue(form, "authHeaderName", input.authHeaderName);
      setFormValue(form, "secret", input.secret);
    }, 0);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onError("");
    setSaving(true);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const input: SourceInput = {
      slug: String(form.get("slug") ?? ""),
      name: String(form.get("name") ?? "") || undefined,
      type,
      baseUrl: String(form.get("baseUrl") ?? "") || undefined,
      specUrl: type === "openapi" ? String(form.get("specUrl") ?? "") || undefined : undefined,
      authType,
      authHeaderName: authType === "header" ? String(form.get("authHeaderName") ?? "") || undefined : undefined,
      secret:
        authType === "none" || authType === "oauth"
          ? undefined
          : String(form.get("secret") ?? "") || undefined
    };

    try {
      await createSource({ data: input });
      if (input.type === "mcp" && input.authType === "oauth") {
        await onCreated();
        await startSourceOAuth(input.slug);
        return;
      }
      formElement.reset();
      setAuthType("none");
      await onCreated();
    } catch (err) {
      onError(formatError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      ref={formRef}
      onSubmit={submit}
      className="grid gap-7 border border-hairline bg-card/60 p-6 md:p-8"
    >
      <FormRow label="examples">
        <div className="flex flex-wrap gap-2">
          <ExampleChip
            icon={<Cable className="size-3" />}
            label="cloudflare-docs.mcp"
            onClick={() =>
              fillExample({
                slug: "cloudflare-docs",
                name: "Cloudflare Docs",
                type: "mcp",
                baseUrl: "https://docs.mcp.cloudflare.com/mcp",
                authType: "none"
              })
            }
          />
          <ExampleChip
            icon={<Database className="size-3" />}
            label="petstore.openapi"
            onClick={() =>
              fillExample({
                slug: "petstore",
                name: "Modern Petstore",
                type: "openapi",
                baseUrl: "https://api.petstoreapi.com/v1",
                specUrl: "https://api.petstoreapi.com/v1/openapi.json",
                authType: "none"
              })
            }
          />
        </div>
      </FormRow>

      <FormRow label="type">
        <SegmentedToggle
          value={type}
          options={[
            { value: "openapi", label: "openapi" },
            { value: "mcp", label: "mcp" }
          ]}
          onChange={(v) => setType(v as SourceType)}
        />
      </FormRow>

      <FormRow label="slug" hint="lowercase, numbers, dashes.">
        <CliInput
          name="slug"
          placeholder={type === "openapi" ? "petstore" : "cloudflare-docs"}
          required
          pattern="[a-z0-9][a-z0-9-]{0,62}"
        />
      </FormRow>

      <FormRow label="name">
        <CliInput
          name="name"
          placeholder={type === "openapi" ? "Modern Petstore" : "Cloudflare Docs"}
        />
      </FormRow>

      <FormRow label={type === "openapi" ? "base_url" : "mcp_url"}>
        <CliInput
          name="baseUrl"
          placeholder={
            type === "openapi" ? "https://api.petstoreapi.com/v1" : "https://docs.mcp.cloudflare.com/mcp"
          }
          required
        />
      </FormRow>

      {type === "openapi" ? (
        <FormRow label="spec_url">
          <CliInput name="specUrl" placeholder="https://api.petstoreapi.com/v1/openapi.json" required />
        </FormRow>
      ) : null}

      <FormRow label="auth">
        <SegmentedToggle
          value={authType}
          options={[
            { value: "none", label: "none" },
            { value: "bearer", label: "bearer" },
            { value: "header", label: "header" },
            { value: "oauth", label: "oauth" }
          ]}
          onChange={(v) => setAuthType(v as SourceAuthType)}
        />
      </FormRow>

      {authType === "header" ? (
        <FormRow label="header">
          <CliInput name="authHeaderName" placeholder="X-API-Key" />
        </FormRow>
      ) : null}

      {authType === "bearer" || authType === "header" ? (
        <FormRow label="secret">
          <CliInput name="secret" type="password" autoComplete="off" placeholder="••••••••" />
        </FormRow>
      ) : null}

      <div className="flex flex-col gap-3 border-t border-hairline pt-6 md:flex-row md:items-center md:justify-between">
        <p className="font-mono text-[11px] text-muted-foreground">
          ▸ secrets are encrypted at rest with the gateway key.
        </p>
        <Button
          type="submit"
          disabled={saving}
          className="rounded-none border-acid bg-acid px-6 font-mono text-[11px] uppercase tracking-[0.22em] text-primary-foreground hover:border-foreground hover:bg-foreground"
        >
          {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
          {saving ? "registering…" : "register source"}
        </Button>
      </div>
    </form>
  );
}

function FormRow({
  label,
  hint,
  children
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-2 md:grid-cols-[10rem_1fr] md:items-start md:gap-6">
      <div className="flex items-center gap-2 pt-2 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
        <span className="text-acid">▸</span>
        <span>{label}</span>
      </div>
      <div className="flex flex-col gap-1.5">
        {children}
        {hint ? <span className="font-mono text-[10px] tracking-wide text-muted-foreground/70">{hint}</span> : null}
      </div>
    </div>
  );
}

function CliInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <Input
      {...props}
      className={`h-10 rounded-none border-0 border-b border-dashed border-hairline-strong bg-transparent px-1 font-mono text-sm text-foreground transition-colors placeholder:text-muted-foreground/50 focus-visible:border-acid focus-visible:ring-0 ${
        props.className ?? ""
      }`}
    />
  );
}

function SegmentedToggle({
  value,
  options,
  onChange
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <ToggleGroup
      value={[value]}
      onValueChange={(next) => {
        if (next[0]) onChange(next[0]);
      }}
      className="border border-hairline-strong"
      variant="outline"
      size="sm"
    >
      {options.map((option) => (
        <ToggleGroupItem
          type="button"
          key={option.value}
          value={option.value}
          className="rounded-none border-0 border-l border-hairline-strong first:border-l-0 data-[pressed]:bg-acid data-[pressed]:text-primary-foreground font-mono text-[11px] uppercase tracking-[0.22em]"
        >
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

function ExampleChip({
  icon,
  label,
  onClick
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      onClick={onClick}
      variant="outline"
      size="sm"
      className="group rounded-none border-dashed border-hairline-strong bg-transparent font-mono text-[11px] tracking-tight text-muted-foreground hover:border-acid hover:bg-transparent hover:text-acid"
    >
      {icon}
      <span>{label}</span>
      <ArrowUpRight className="size-3 opacity-0 transition-opacity group-hover:opacity-100" />
    </Button>
  );
}

/* ────────────────────────────────────────────────────────────── */

function Empty({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col items-start gap-2 border border-dashed border-hairline-strong bg-card/40 p-8">
      <span className="ascii-divider text-acid/60">▒▒░░░░░░ ▌</span>
      <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-foreground">{title}</p>
      <p className="font-mono text-[11px] text-muted-foreground">{description}</p>
    </div>
  );
}

function SuccessAlert({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-3 border-l-2 border-acid bg-acid-soft px-4 py-3">
      <CheckCircle2 className="mt-0.5 size-4 text-acid" />
      <div className="flex flex-col gap-0.5">
        <span className="label-tag text-acid">ok</span>
        <p className="font-mono text-sm text-foreground">{message}</p>
      </div>
    </div>
  );
}

function ErrorAlert({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-3 border-l-2 border-destructive bg-destructive/10 px-4 py-3">
      <TriangleAlert className="mt-0.5 size-4 text-destructive" />
      <div className="flex flex-col gap-0.5">
        <span className="label-tag text-destructive">error</span>
        <p className="font-mono text-sm text-foreground">{message}</p>
      </div>
    </div>
  );
}

function Footer() {
  return (
    <footer className="flex flex-col gap-3 border-t border-hairline pt-6 md:flex-row md:items-center md:justify-between">
      <p className="overflow-hidden font-mono text-[10px] tracking-[0.4em] text-muted-foreground/50">
        {RULE}
      </p>
      <p className="shrink-0 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
        gateway · cloudflare workers · code-mode
      </p>
    </footer>
  );
}

/* ────────────────────────────────────────────────────────────── */

export function LoginPage() {
  const [error, setError] = useState("");
  return <AuthShell error={error} setError={setError} title="initiate session" />;
}

function AuthGate({ error }: { error: string }) {
  const [, setError] = useState(error);
  return <AuthShell error={error} setError={setError} title="restricted" />;
}

function AuthShell({
  error,
  setError,
  title
}: {
  error: string;
  setError: (msg: string) => void;
  title: string;
}) {
  return (
    <main className="grid min-h-svh place-items-center px-5 py-10">
      <div className="w-full max-w-md stagger-fade">
        <div className="mb-8 flex items-center gap-3">
          <span className="diode" aria-hidden />
          <span className="label-tag">[ access · oidc ]</span>
        </div>

        <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          // dev/mcp
        </div>
        <h1 className="font-display text-6xl italic leading-[0.95] tracking-tight text-foreground">
          {title}
          <span className="text-acid acid-glow">.</span>
        </h1>
        <p className="mt-5 max-w-sm font-mono text-sm text-muted-foreground">
          The same Better Auth session protects the dashboard and the MCP endpoint.
          Continue with your configured OpenID Connect provider.
        </p>

        <div className="mt-8 ascii-divider">────── // PROCEED ──────</div>

        <div className="mt-6 flex flex-col gap-3">
          <Button
            type="button"
            onClick={() => {
              setError("");
              void login().catch((err) => setError(formatError(err)));
            }}
            className="group h-auto justify-between rounded-none border-acid bg-acid px-5 py-3.5 font-mono text-[11px] uppercase tracking-[0.22em] text-primary-foreground hover:border-foreground hover:bg-foreground"
          >
            <span className="flex items-center gap-2">
              <ShieldCheck className="size-3.5" />
              continue with oidc
            </span>
            <span className="transition-transform group-hover:translate-x-1">↗</span>
          </Button>
          {error ? <ErrorAlert message={error} /> : null}
        </div>

        <p className="mt-10 font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground/50">
          better auth · cloudflare workers
        </p>
      </div>
    </main>
  );
}

/* ────────────────────────────────────────────────────────────── */

function LoadingView() {
  return (
    <main className="min-h-svh px-5 pb-24 pt-10 md:px-10">
      <div className="mx-auto flex max-w-6xl flex-col gap-10">
        <div className="flex items-center gap-3">
          <span className="diode" aria-hidden />
          <span className="label-tag">booting…</span>
        </div>
        <Skeleton className="h-32 w-full max-w-3xl rounded-none bg-card/50" />
        <div className="grid gap-px bg-hairline md:grid-cols-3">
          <Skeleton className="h-32 rounded-none bg-card" />
          <Skeleton className="h-32 rounded-none bg-card" />
          <Skeleton className="h-32 rounded-none bg-card" />
        </div>
        <Skeleton className="h-96 rounded-none bg-card/40" />
      </div>
    </main>
  );
}

/* ────────────────────────────────────────────────────────────── */

async function login(): Promise<void> {
  const response = await requestJson<{ url?: string }>("/api/auth/sign-in/oauth2", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ providerId: "oidc", callbackURL: "/" })
  });
  if (!response.url) throw new Error("OIDC provider did not return a redirect URL");
  window.location.href = response.url;
}

async function logout(): Promise<void> {
  await fetch("/api/auth/sign-out", { method: "POST" });
  window.location.href = "/login";
}

async function startSourceOAuth(slug: string): Promise<void> {
  const response = await requestJson<{ status: "connected" | "auth_required"; authUrl?: string }>(
    `/api/sources/${encodeURIComponent(slug)}/oauth/start`,
    { method: "POST" }
  );
  if (response.status === "connected") {
    toast.success("OAuth source connected.");
    return;
  }
  if (!response.authUrl) throw new Error("OAuth source did not return an authorization URL");
  const popup = window.open(response.authUrl, "dev-mcp-oauth", "width=640,height=760");
  if (!popup) window.location.href = response.authUrl;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const text = await response.text();
  const data = text ? (JSON.parse(text) as unknown) : null;
  if (!response.ok) {
    const message =
      data && typeof data === "object" && "error" in data
        ? String((data as { error: unknown }).error)
        : response.statusText;
    throw new Error(message);
  }
  return data as T;
}

function setFormValue(form: HTMLFormElement, name: string, value: string | undefined) {
  const field = form.elements.namedItem(name);
  if (field instanceof HTMLInputElement) field.value = value ?? "";
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
