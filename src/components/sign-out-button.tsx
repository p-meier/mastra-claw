import { LogOutIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { signOutAction } from '@/app/(auth)/login/actions';

/**
 * Server Component that wraps the sign-out Server Action in a plain
 * `<form>`. No 'use client' needed — Server Actions work directly from
 * server-rendered forms in the App Router.
 */
export function SignOutButton() {
  return (
    <form action={signOutAction}>
      <Button type="submit" variant="ghost" size="sm">
        <LogOutIcon />
        Sign out
      </Button>
    </form>
  );
}
