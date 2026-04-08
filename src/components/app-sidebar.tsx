"use client"

import * as React from "react"
import Image from "next/image"
import Link from "next/link"
import {
  BarChart3Icon,
  BookOpenIcon,
  BotIcon,
  ChevronsUpDownIcon,
  CircuitBoardIcon,
  DatabaseIcon,
  GaugeIcon,
  LifeBuoyIcon,
  LogOutIcon,
  MessagesSquareIcon,
  PlugIcon,
  SettingsIcon,
  ShieldCheckIcon,
  SparklesIcon,
  WorkflowIcon,
} from "lucide-react"

import { signOutAction } from "@/app/(auth)/login/actions"
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar"
import type { CurrentUser } from "@/lib/auth"

const nav = {
  navPlatform: [
    { title: "Dashboard", url: "/", icon: GaugeIcon },
    { title: "Agents", url: "#", icon: BotIcon },
    { title: "Workflows", url: "#", icon: WorkflowIcon },
    { title: "Tools", url: "#", icon: CircuitBoardIcon },
    { title: "Memory", url: "#", icon: DatabaseIcon },
    { title: "Knowledge", url: "#", icon: BookOpenIcon },
  ],
  navInsights: [
    { title: "Traces", url: "#", icon: BarChart3Icon },
    { title: "Evaluations", url: "#", icon: SparklesIcon },
    { title: "Guardrails", url: "#", icon: ShieldCheckIcon },
  ],
  navSettings: [
    { title: "Channels", url: "#", icon: MessagesSquareIcon },
    { title: "Integrations", url: "#", icon: PlugIcon },
    { title: "Settings", url: "#", icon: SettingsIcon },
    { title: "Support", url: "#", icon: LifeBuoyIcon },
  ],
} as const

function emailToInitials(email: string): string {
  if (!email) return "??"
  const local = email.split("@")[0] ?? ""
  const parts = local.split(/[._-]+/).filter(Boolean)
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase()
  }
  return local.slice(0, 2).toUpperCase()
}

function emailToDisplayName(email: string): string {
  if (!email) return "Unknown"
  const local = email.split("@")[0] ?? ""
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ")
}

export function AppSidebar({ currentUser }: { currentUser: CurrentUser }) {
  const initials = emailToInitials(currentUser.email)
  const displayName = emailToDisplayName(currentUser.email)

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/">
                <Image
                  src="/logo.png"
                  alt="MastraClaw"
                  width={40}
                  height={40}
                  priority
                  className="size-9 shrink-0 rounded-md object-contain group-data-[collapsible=icon]:size-8"
                />
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">MastraClaw</span>
                  <span className="text-muted-foreground truncate text-xs">
                    Enterprise AI Agent
                  </span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Platform</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {nav.navPlatform.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild tooltip={item.title}>
                    <Link href={item.url}>
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Insights</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {nav.navInsights.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild tooltip={item.title}>
                    <Link href={item.url}>
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="mt-auto">
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {nav.navSettings.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild tooltip={item.title}>
                    <Link href={item.url}>
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size="lg"
                  className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                >
                  <Avatar className="size-8 rounded-lg">
                    <AvatarImage src="" alt={displayName} />
                    <AvatarFallback className="rounded-lg bg-gradient-to-br from-violet-500 to-cyan-400 text-white font-medium">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-semibold">
                      {displayName}
                    </span>
                    <span className="text-muted-foreground truncate text-xs">
                      {currentUser.email}
                    </span>
                  </div>
                  <ChevronsUpDownIcon className="ml-auto size-4" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
                side="right"
                align="end"
                sideOffset={4}
              >
                <DropdownMenuLabel className="p-0 font-normal">
                  <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                    <Avatar className="size-8 rounded-lg">
                      <AvatarImage src="" alt={displayName} />
                      <AvatarFallback className="rounded-lg bg-gradient-to-br from-violet-500 to-cyan-400 text-white font-medium">
                        {initials}
                      </AvatarFallback>
                    </Avatar>
                    <div className="grid flex-1 text-left text-sm leading-tight">
                      <span className="truncate font-semibold">
                        {displayName}
                      </span>
                      <span className="text-muted-foreground truncate text-xs">
                        {currentUser.email}
                      </span>
                    </div>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem asChild>
                    <Link href="/account/settings" className="cursor-pointer">
                      <SettingsIcon />
                      Account Settings
                    </Link>
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                {/*
                  Sign-out is a Server Action wrapped in a form. Using
                  `asChild` to render the DropdownMenuItem as the form's
                  submit button means the keyboard shortcut + Radix UI
                  semantics still work, while the actual POST happens via
                  the form's `action`.
                */}
                <form action={signOutAction}>
                  <DropdownMenuItem asChild>
                    <button
                      type="submit"
                      className="w-full cursor-pointer"
                    >
                      <LogOutIcon />
                      Sign out
                    </button>
                  </DropdownMenuItem>
                </form>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  )
}
