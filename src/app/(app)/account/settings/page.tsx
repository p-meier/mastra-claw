import { redirect } from "next/navigation"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { SidebarInset, SidebarTrigger } from "@/components/ui/sidebar"
import { requireAdmin } from "@/lib/auth"
import { loadProfile } from "@/lib/onboarding/profile"

import { ProfilePreferencesForm } from "./_components/profile-preferences-form"

export const metadata = {
  title: "Account Settings — MastraClaw",
}

export default async function AccountSettingsPage() {
  const currentUser = await requireAdmin()
  const profile = await loadProfile(currentUser.userId)

  // The proxy gate normally bounces unfinished onboarding to /onboarding,
  // but be defensive in case of direct URL access.
  if (!profile?.onboardingCompletedAt) {
    redirect("/onboarding")
  }

  return (
    <SidebarInset>
      <header className="bg-background sticky top-0 z-10 flex h-16 shrink-0 items-center gap-3 border-b px-4 sm:px-6">
        <SidebarTrigger className="-ml-2" />
        <div className="ml-2 flex min-w-0 flex-1 items-center justify-between gap-2">
          <div className="flex min-w-0 flex-col">
            <h1 className="truncate text-sm font-semibold leading-none">
              Account Settings
            </h1>
            <span className="text-muted-foreground truncate text-xs">
              {currentUser.email}
            </span>
          </div>
        </div>
      </header>

      <div className="flex flex-1 flex-col gap-6 p-4 sm:p-6">
        <Card>
          <CardHeader>
            <CardTitle>Personal preferences</CardTitle>
            <CardDescription>
              How your assistant addresses you, and what it should know
              about you. Both fields are read on every chat — changes
              apply on the next message.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ProfilePreferencesForm
              initialNickname={profile.nickname ?? ""}
              initialUserPreferences={profile.userPreferences ?? ""}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Account</CardTitle>
            <CardDescription>
              Read-only account info. Profile editing, password change,
              MFA, API tokens land here next.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2">
              <dt className="font-medium text-foreground">Email</dt>
              <dd className="font-mono break-all">{currentUser.email}</dd>
              <dt className="font-medium text-foreground">User ID</dt>
              <dd className="font-mono break-all text-xs">
                {currentUser.userId}
              </dd>
              <dt className="font-medium text-foreground">Role</dt>
              <dd className="font-mono">{currentUser.role}</dd>
            </dl>
          </CardContent>
        </Card>
      </div>
    </SidebarInset>
  )
}
