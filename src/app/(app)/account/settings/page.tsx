import { ConstructionIcon } from "lucide-react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { SidebarInset, SidebarTrigger } from "@/components/ui/sidebar"
import { requireAdmin } from "@/lib/auth"

export const metadata = {
  title: "Account Settings — MastraClaw",
}

export default async function AccountSettingsPage() {
  const currentUser = await requireAdmin()

  return (
    <SidebarInset>
      <header className="flex h-16 shrink-0 items-center gap-3 px-6">
        <SidebarTrigger className="-ml-2" />
        <div className="ml-2 flex flex-1 items-center justify-between gap-2">
          <div className="flex flex-col">
            <h1 className="text-sm font-semibold leading-none">
              Account Settings
            </h1>
            <span className="text-muted-foreground text-xs">
              Profile, security, and preferences for {currentUser.email}
            </span>
          </div>
        </div>
      </header>

      <div className="flex flex-1 flex-col gap-6 p-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ConstructionIcon className="size-4 text-muted-foreground" />
              Coming soon
            </CardTitle>
            <CardDescription>
              Profile editing, password change, MFA, API tokens, and
              workspace preferences will live here. For now, manage your
              user record directly in the Supabase dashboard.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2">
              <dt className="font-medium text-foreground">Email</dt>
              <dd className="font-mono">{currentUser.email}</dd>
              <dt className="font-medium text-foreground">User ID</dt>
              <dd className="font-mono text-xs">{currentUser.userId}</dd>
              <dt className="font-medium text-foreground">Role</dt>
              <dd className="font-mono">{currentUser.role}</dd>
            </dl>
          </CardContent>
        </Card>
      </div>
    </SidebarInset>
  )
}
