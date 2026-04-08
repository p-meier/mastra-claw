import {
  ActivityIcon,
  ArrowUpRightIcon,
  BotIcon,
  CheckCircle2Icon,
  ClockIcon,
  PlusIcon,
  WorkflowIcon,
  ZapIcon,
} from "lucide-react"

import { SignOutButton } from "@/components/sign-out-button"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { SidebarInset, SidebarTrigger } from "@/components/ui/sidebar"
import { requireAdmin } from "@/lib/auth"

const stats = [
  {
    label: "Active Agents",
    value: "4",
    delta: "+1 this week",
    icon: BotIcon,
  },
  {
    label: "Workflow Runs (24h)",
    value: "128",
    delta: "+12.4%",
    icon: WorkflowIcon,
  },
  {
    label: "Avg. Latency",
    value: "842ms",
    delta: "−6.1%",
    icon: ZapIcon,
  },
  {
    label: "Success Rate",
    value: "98.2%",
    delta: "+0.3%",
    icon: CheckCircle2Icon,
  },
]

const recentRuns = [
  {
    id: "wf_01",
    name: "research-and-brief",
    agent: "Orchestrator",
    status: "success",
    duration: "12.4s",
  },
  {
    id: "wf_02",
    name: "calendar-summary",
    agent: "CalendarSpecialist",
    status: "success",
    duration: "3.8s",
  },
  {
    id: "wf_03",
    name: "email-draft",
    agent: "WritingSpecialist",
    status: "running",
    duration: "—",
  },
  {
    id: "wf_04",
    name: "knowledge-ingest",
    agent: "RAGSpecialist",
    status: "success",
    duration: "47.1s",
  },
  {
    id: "wf_05",
    name: "telegram-reply",
    agent: "Orchestrator",
    status: "failed",
    duration: "1.2s",
  },
]

const statusVariant: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  success: "secondary",
  running: "default",
  failed: "destructive",
}

export default async function DashboardPage() {
  // The (app) layout already enforces requireAdmin(), but we keep the
  // explicit assertion at the call site per the CLAUDE.md "defense-in-depth"
  // rule. Cached via React.cache, so it's a no-op call.
  await requireAdmin()

  return (
    <>
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-3 px-6">
          <SidebarTrigger className="-ml-2" />
          <div className="ml-2 flex flex-1 items-center justify-between gap-2">
            <div className="flex flex-col">
              <h1 className="text-sm font-semibold leading-none">Dashboard</h1>
              <span className="text-muted-foreground text-xs">
                Overview of your agents, workflows, and runs
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm">
                <PlusIcon />
                New Agent
              </Button>
              <SignOutButton />
            </div>
          </div>
        </header>

        <div className="flex flex-1 flex-col gap-6 p-6">
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {stats.map((stat) => (
              <Card key={stat.label}>
                <CardHeader>
                  <CardDescription>{stat.label}</CardDescription>
                  <CardTitle className="text-3xl">{stat.value}</CardTitle>
                </CardHeader>
                <CardFooter className="flex items-center justify-between">
                  <Badge variant="secondary">{stat.delta}</Badge>
                  <stat.icon className="text-muted-foreground size-4" />
                </CardFooter>
              </Card>
            ))}
          </section>

          <section className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Recent Workflow Runs</CardTitle>
                <CardDescription>
                  Latest executions across all agents and workflows
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {recentRuns.map((run) => (
                  <div
                    key={run.id}
                    className="flex items-center justify-between gap-4 rounded-lg border p-3"
                  >
                    <div className="flex items-center gap-3">
                      <Avatar className="size-9">
                        <AvatarFallback>
                          {run.agent.slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex flex-col">
                        <span className="text-sm font-medium">{run.name}</span>
                        <span className="text-muted-foreground text-xs">
                          {run.agent}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-muted-foreground hidden items-center gap-1 text-xs sm:flex">
                        <ClockIcon className="size-3" />
                        {run.duration}
                      </div>
                      <Badge variant={statusVariant[run.status]}>
                        {run.status}
                      </Badge>
                    </div>
                  </div>
                ))}
              </CardContent>
              <CardFooter>
                <Button variant="ghost" size="sm" className="ml-auto">
                  View all runs
                  <ArrowUpRightIcon />
                </Button>
              </CardFooter>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>System Status</CardTitle>
                <CardDescription>
                  Health of integrated components
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {[
                  { name: "Mastra API", status: "operational" },
                  { name: "Convex", status: "operational" },
                  { name: "Langfuse", status: "operational" },
                  { name: "Inngest", status: "degraded" },
                ].map((s) => (
                  <div
                    key={s.name}
                    className="flex items-center justify-between"
                  >
                    <div className="flex items-center gap-2">
                      <ActivityIcon className="text-muted-foreground size-4" />
                      <span className="text-sm">{s.name}</span>
                    </div>
                    <Badge
                      variant={
                        s.status === "operational" ? "secondary" : "destructive"
                      }
                    >
                      {s.status}
                    </Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          </section>
        </div>
      </SidebarInset>
    </>
  )
}
