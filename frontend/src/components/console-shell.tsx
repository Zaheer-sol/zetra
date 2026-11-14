"use client";

import Link from "next/link";
import { usePrivy } from "@privy-io/react-auth";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useState, type ComponentType, type ReactNode } from "react";
import {
  ArrowDownLeft,
  BookMarked,
  BookOpen,
  Building2,
  ChartColumn,
  Check,
  ChevronDown,
  ChevronsUpDown,
  Code2,
  CreditCard,
  Sparkles,
  Inbox,
  LayoutGrid,
  ListTree,
  LogOut,
  MessageSquareText,
  NotebookPen,
  Plus,
  Receipt,
  Scale,
  Search,
  Settings,
  Users,
  Wallet
} from "lucide-react";
import { api, useApi } from "@/lib/api";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar
} from "@/components/ui/sidebar";
import { AssistantButton, AssistantProvider, NotificationsBell } from "./assistant";
import { SessionProvider, useMe, useSession, type Me } from "./session";
import { Button, ButtonLink, Logo, useToast } from "./app-ui";
import { motion, SPRING } from "./motion";
import { Zeti } from "./zeti";

export function ConsoleShell({ children }: { children: ReactNode }) {
  const { data: me, error, mutate: refresh } = useMe();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (error?.status === 401) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [error, router, pathname]);
  useEffect(() => {
    if (me && me.kind === "user" && !me.organization) router.replace("/onboarding");
  }, [me, router]);

  if (error && error.status !== 401) {
    return (
      <div className="grid min-h-screen place-items-center p-6">
        <Card className="max-w-[420px] items-center px-6 text-center">
          <Zeti mood="attention" size={96} />
          <div>
            <h1 className="text-[1.0625rem] font-semibold">Zetra is temporarily unavailable</h1>
            <p className="mt-1.5 text-muted-foreground">{error.message}</p>
          </div>
          <Button onClick={() => refresh()}>Try again</Button>
        </Card>
      </div>
    );
  }
  if (!me || !me.organization) {
    return (
      <div className="grid min-h-screen place-items-center" role="status" aria-label="Loading your workspace">
        <div className="grid justify-items-center gap-3">
          <Zeti mood="focused" size={96} priority />
          <p className="text-sm text-muted-foreground">Getting your workspace ready…</p>
        </div>
      </div>
    );
  }
  return (
    <SessionProvider me={me} refresh={refresh}>
      <Frame>{children}</Frame>
    </SessionProvider>
  );
}

function Frame({ children }: { children: ReactNode }) {
  const { isTest } = useSession();
  return (
    <AssistantProvider>
      <SidebarProvider>
        <ConsoleSidebar />
        <SidebarInset className="min-w-0 bg-background">
          {isTest && (
            <div className="flex items-center justify-center gap-2 border-b border-warning/25 bg-warning/10 px-4 py-[7px] text-center text-sm font-medium text-warning" role="note">
              <Sparkles className="size-3.5 shrink-0" aria-hidden="true" />
              Zetra Demo workspace · Sample records are for demonstration; simulated payments do not move funds.
            </div>
          )}
          <Topbar />
          <main id="main" className="mx-auto w-full max-w-[1320px] px-10 pt-10 pb-20 max-md:px-4 max-md:pt-6 max-md:pb-12">
            {children}
          </main>
        </SidebarInset>
      </SidebarProvider>
    </AssistantProvider>
  );
}

function NavGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <SidebarGroup className="py-1">
      <SidebarGroupLabel className="text-[11.5px] font-semibold text-muted-foreground">{label}</SidebarGroupLabel>
      <SidebarGroupContent>{children}</SidebarGroupContent>
    </SidebarGroup>
  );
}

/** A collapsed group for tools most people rarely need. Opens by itself when one of its pages is showing. */
function MoreGroup({ open, children }: { open: boolean; children: ReactNode }) {
  const [expanded, setExpanded] = useState(open);
  useEffect(() => {
    if (open) setExpanded(true);
  }, [open]);
  const id = useId();
  return (
    <SidebarGroup className="py-1">
      <SidebarGroupLabel asChild className="text-[11.5px] font-semibold text-muted-foreground">
        <button type="button" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded((v) => !v)} className="flex w-full cursor-pointer items-center justify-between hover:text-foreground">
          More
          <ChevronDown className={cn("size-3.5 transition-transform", expanded && "rotate-180")} aria-hidden="true" />
        </button>
      </SidebarGroupLabel>
      <SidebarGroupContent id={id} hidden={!expanded}>
        {children}
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

type NavLink = { href: string; label: string; icon: ComponentType<{ className?: string }>; exact?: boolean; count?: string | null; external?: boolean; also?: string[] };

function ConsoleSidebar() {
  const pathname = usePathname();
  const { can } = useSession();
  const { isMobile, setOpenMobile } = useSidebar();
  useEffect(() => {
    if (isMobile) setOpenMobile(false);
  }, [pathname, isMobile, setOpenMobile]);
  const { data: open } = useApi<{ data: unknown[]; has_more: boolean }>("/v1/exceptions?status=open&limit=100", { refreshInterval: 15000 });
  const openCount = open ? `${open.data.length}${open.has_more ? "+" : ""}` : null;
  const is = (href: string, exact = false) => (exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`));

  const main: NavLink[] = [
    { href: "/app", label: "Overview", icon: LayoutGrid, exact: true },
    { href: "/app/exceptions", label: "Needs review", icon: Inbox, count: openCount },
    { href: "/app/assistant", label: "Zeti", icon: MessageSquareText }
  ];
  const getPaid: NavLink[] = [
    { href: "/app/invoices", label: "Invoices", icon: Receipt },
    { href: "/app/payments", label: "Payments", icon: ArrowDownLeft },
    // The core job: every payment checked against what was expected.
    { href: "/app/reconciliation", label: "Reconciliation", icon: Scale },
    { href: "/app/customers", label: "Customers", icon: Users },
    { href: "/app/wallets", label: "Wallets", icon: Wallet }
  ];
  const books: NavLink[] = [
    { href: "/app/accounting", label: "Books", icon: BookMarked, exact: true },
    { href: "/app/reports", label: "Reports", icon: ChartColumn },
    // Bills, expenses and vendors share one entry; tabs switch between them.
    { href: "/app/bills", label: "Spending", icon: CreditCard, also: ["/app/expenses", "/app/vendors"] }
  ];
  // Accountant and developer tools, out of the way until someone needs them.
  const more: NavLink[] = [
    ...(can("financials:read")
      ? [
          { href: "/app/accounting/journal", label: "Journal", icon: NotebookPen },
          { href: "/app/accounting/accounts", label: "Chart of accounts", icon: ListTree }
        ]
      : []),
    { href: "/app/developers", label: "Developers", icon: Code2 },
    { href: "/docs", label: "Docs", icon: BookOpen, external: true }
  ];
  const moreActive = more.some((l) => !l.external && is(l.href, l.exact));

  const renderLinks = (links: NavLink[]) => (
    <SidebarMenu className="gap-px">
      {links.map(({ href, label, icon: Icon, exact, count, external, also }) => {
        const active = !external && (is(href, exact) || !!also?.some((a) => is(a)));
        return (
          <SidebarMenuItem key={href}>
            <SidebarMenuButton
              asChild
              isActive={active}
              tooltip={label}
              className="relative isolate h-8 font-medium transition-colors data-[active=true]:bg-transparent data-[active=true]:font-semibold data-[active=true]:[&>span:first-child]:bg-primary data-[active=true]:[&>span:first-child]:text-primary-foreground [&>span:first-child>svg]:size-[15px]"
            >
              <Link href={href} aria-current={active ? "page" : undefined} target={external ? "_blank" : undefined}>
                {active && <motion.span layoutId="sidebar-active" className="absolute inset-0 -z-10 rounded-md bg-sidebar-accent" transition={SPRING} aria-hidden="true" />}
                <span className="grid size-6 shrink-0 place-items-center rounded-lg bg-sidebar-accent/70 text-sidebar-primary transition-colors group-data-[collapsible=icon]:size-7 data-[active=true]:bg-primary data-[active=true]:text-primary-foreground">
                  <Icon />
                </span>
                <span>{label}</span>
              </Link>
            </SidebarMenuButton>
            {count && count !== "0" && (
              <SidebarMenuBadge className="rounded-full bg-sidebar-accent px-1.5 text-[11px] font-semibold tabular-nums" aria-label={`${count} need attention`}>
                {count}
              </SidebarMenuBadge>
            )}
          </SidebarMenuItem>
        );
      })}
    </SidebarMenu>
  );

  return (
    <Sidebar aria-label="Primary">
      <SidebarHeader className="gap-3 px-3 pt-4">
        <Link href="/app" aria-label="Zetra home" className="px-1.5 pb-1">
          <Logo size={22} />
        </Link>
        <WorkspaceSwitcher />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <nav aria-label="Console">{renderLinks(main)}</nav>
          </SidebarGroupContent>
        </SidebarGroup>
        <NavGroup label="Get paid">{renderLinks(getPaid)}</NavGroup>
        {can("financials:read") && <NavGroup label="Books">{renderLinks(books)}</NavGroup>}
        <MoreGroup open={moreActive}>{renderLinks(more)}</MoreGroup>
      </SidebarContent>
      <SidebarFooter className="gap-2 px-3 pb-3">
        <nav aria-label="Account">{renderLinks([{ href: "/app/settings", label: "Settings", icon: Settings }])}</nav>
        <UserMenu />
      </SidebarFooter>
    </Sidebar>
  );
}

function WorkspaceSwitcher() {
  const { me } = useSession();
  const toast = useToast();
  const switchTo = async (id: string) => {
    try {
      await api("/v1/session/organization", { method: "POST", body: { organization_id: id } });
      window.location.href = "/app";
    } catch (e) {
      toast("error", (e as Error).message);
    }
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex w-full cursor-pointer items-center gap-2.5 rounded-xl bg-card p-2 text-left shadow-card transition-shadow hover:shadow-raised">
          <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-primary to-[#2365de] text-xs font-bold text-primary-foreground shadow-[0_5px_16px_var(--brand-soft)]" aria-hidden="true">
            {initials(me.organization?.name)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate leading-tight font-semibold">{me.organization?.name}</span>
            <span className="text-xs text-muted-foreground capitalize">{me.role}</span>
          </span>
          <ChevronsUpDown className="size-[15px] text-muted-foreground" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-(--radix-dropdown-menu-trigger-width) min-w-56">
        <DropdownMenuLabel className="text-xs font-semibold text-muted-foreground">Workspaces</DropdownMenuLabel>
        {me.organizations.map((o) => (
          <DropdownMenuItem key={o.id} onSelect={() => switchTo(o.id)}>
            <Building2 aria-hidden="true" />
            <span className="flex-1 truncate">{o.name}</span>
            {o.id === me.organization?.id && <Check aria-hidden="true" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/onboarding?new=1">
            <Plus aria-hidden="true" /> New business
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UserMenu() {
  const { me } = useSession();
  const { logout: logoutPrivy } = usePrivy();
  const logout = async () => {
    await Promise.all([
      api("/v1/auth/logout", { method: "POST" }).catch(() => undefined),
      logoutPrivy().catch(() => undefined)
    ]);
    window.location.href = "/login";
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex w-full cursor-pointer items-center gap-2.5 rounded-xl p-2 text-left transition-colors hover:bg-sidebar-accent">
          <Avatar className="size-7">
            <AvatarFallback className="bg-primary/12 text-xs font-bold text-primary">{initials(me.user.name)}</AvatarFallback>
          </Avatar>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">{me.user.name}</span>
            <span className="block truncate text-xs text-muted-foreground">{me.user.email}</span>
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-(--radix-dropdown-menu-trigger-width) min-w-56">
        <DropdownMenuItem onSelect={logout}>
          <LogOut aria-hidden="true" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Topbar() {
  const router = useRouter();
  const [q, setQ] = useState("");
  return (
    <div className="material sticky top-0 z-20 flex h-[52px] items-center gap-3 border-b border-sidebar-border/70 px-8 max-md:px-4">
      <SidebarTrigger className="-ml-1 md:hidden" aria-label="Open navigation" />
      <Separator orientation="vertical" className="data-[orientation=vertical]:h-5 md:hidden" />
      <form
        className="relative max-w-[440px] flex-1 max-lg:hidden"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) router.push(`/app/payments?search=${encodeURIComponent(q.trim())}`);
        }}
      >
        <Search className="pointer-events-none absolute top-1/2 left-3 size-[15px] -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          className="h-[34px] rounded-[10px] border-transparent bg-muted pl-9 focus-visible:bg-card dark:bg-muted"
          placeholder="Search payments by customer, invoice, address or transaction"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search payments"
        />
      </form>
      <div className="ml-auto flex items-center gap-2">
        <MonitoringIndicator />
        <AssistantButton />
        <NotificationsBell />
        <ButtonLink href="/app/invoices/new" variant="primary" size="sm" icon={<Plus aria-hidden="true" />}>
          New invoice
        </ButtonLink>
      </div>
    </div>
  );
}

function MonitoringIndicator() {
  const { data } = useApi<{ data: Array<{ sync: { status: string } | null; network_name: string }> }>("/v1/wallets", { refreshInterval: 10000 });
  const wallets = data?.data ?? [];
  if (!data) return null;
  const pill = "inline-flex items-center gap-[7px] rounded-full bg-muted px-[11px] py-[5px] text-sm whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground max-lg:hidden";
  if (!wallets.length)
    return (
      <Link href="/app/wallets" className={pill}>
        <span className="size-[7px] rounded-full bg-muted-foreground" /> No wallet monitored
      </Link>
    );
  const bad = wallets.find((w) => w.sync && ["delayed", "error", "unavailable"].includes(w.sync.status));
  const starting = wallets.find((w) => w.sync?.status === "starting");
  const network = wallets[0]!.network_name;
  return (
    <Link href="/app/wallets" className={pill} title="Wallet monitoring status">
      <span className={cn("size-[7px] rounded-full", bad ? "bg-warning ring-3 ring-warning/15" : starting ? "bg-muted-foreground" : "bg-success ring-3 ring-success/15")} />
      {bad ? "Monitoring delayed" : starting ? "Starting monitor…" : `Live on ${network}`}
    </Link>
  );
}

export type { Me };
