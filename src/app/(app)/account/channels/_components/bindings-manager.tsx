'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  type UserChannelBinding,
  createBindingAction,
  deleteBindingAction,
} from '@/lib/channels/user-bindings-actions';

/**
 * Client-side manager for one user's channel bindings. The list and the
 * "add" form share state so the UI stays responsive between server
 * round-trips. Server actions handle every mutation; this component
 * just renders + revalidates.
 */

export type ChannelOption = {
  id: string;
  displayName: string;
  externalIdLabel: string;
  externalIdHelp?: {
    text: string;
    url?: string;
  };
};

export type AgentOption = {
  id: string;
  displayName: string;
};

export type BindingsManagerProps = {
  initialBindings: UserChannelBinding[];
  channelOptions: ChannelOption[];
  agentOptions: AgentOption[];
};

export function BindingsManager({
  initialBindings,
  channelOptions,
  agentOptions,
}: BindingsManagerProps) {
  const router = useRouter();
  const [bindings, setBindings] = useState(initialBindings);
  const [addOpen, setAddOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleDelete(id: string): void {
    if (!confirm('Delete this binding? Messages on that account will stop reaching your agent.')) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const r = await deleteBindingAction(id);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setBindings((prev) => prev.filter((b) => b.id !== id));
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {bindings.length === 0
            ? 'No connected accounts yet.'
            : `${bindings.length} connected account${bindings.length === 1 ? '' : 's'}.`}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={channelOptions.length === 0}
          onClick={() => setAddOpen(true)}
        >
          Add binding
        </Button>
      </div>

      {channelOptions.length === 0 && (
        <p className="text-xs text-muted-foreground">
          The admin hasn’t configured any channels yet. Once a channel is
          available it will show up here.
        </p>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="grid gap-3 sm:grid-cols-2">
        {bindings.map((binding) => {
          const channel = channelOptions.find((c) => c.id === binding.channelId);
          const agent = agentOptions.find((a) => a.id === binding.agentId);
          return (
            <Card key={binding.id}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {channel?.displayName ?? binding.channelId}
                  <Badge>Active</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 text-xs">
                <div>
                  <span className="text-muted-foreground">
                    {channel?.externalIdLabel ?? 'External ID'}
                  </span>
                  <code className="ml-2 rounded bg-muted px-1.5 py-0.5 font-mono">
                    {binding.externalId}
                  </code>
                </div>
                <div>
                  <span className="text-muted-foreground">Agent</span>
                  <span className="ml-2">
                    {agent?.displayName ?? binding.agentId}
                  </span>
                </div>
                <div className="flex justify-end pt-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={pending}
                    onClick={() => handleDelete(binding.id)}
                  >
                    Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a connected account</DialogTitle>
            <DialogDescription>
              Pick a channel, paste the platform-specific identifier the bot
              sees for you, and choose which agent should reply.
            </DialogDescription>
          </DialogHeader>
          <AddBindingForm
            channelOptions={channelOptions}
            agentOptions={agentOptions}
            onCreated={(binding) => {
              setBindings((prev) => [binding, ...prev]);
              setAddOpen(false);
              router.refresh();
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AddBindingForm({
  channelOptions,
  agentOptions,
  onCreated,
}: {
  channelOptions: ChannelOption[];
  agentOptions: AgentOption[];
  onCreated: (b: UserChannelBinding) => void;
}) {
  const [channelId, setChannelId] = useState(channelOptions[0]?.id ?? '');
  const [externalId, setExternalId] = useState('');
  const [agentId, setAgentId] = useState(agentOptions[0]?.id ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const channel = channelOptions.find((c) => c.id === channelId);

  function onSubmit(e: React.FormEvent): void {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const r = await createBindingAction({ channelId, externalId, agentId });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      onCreated(r.binding);
    });
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={onSubmit}>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="binding-channel">Channel</Label>
        <Select value={channelId} onValueChange={setChannelId}>
          <SelectTrigger id="binding-channel">
            <SelectValue placeholder="Pick a channel" />
          </SelectTrigger>
          <SelectContent>
            {channelOptions.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.displayName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="binding-external">
          {channel?.externalIdLabel ?? 'External ID'}
        </Label>
        <Input
          id="binding-external"
          value={externalId}
          onChange={(e) => setExternalId(e.target.value)}
          placeholder="123456789"
        />
        {channel?.externalIdHelp && (
          <p className="text-xs text-muted-foreground">
            {channel.externalIdHelp.text}
            {channel.externalIdHelp.url && (
              <>
                {' '}
                <a
                  href={channel.externalIdHelp.url}
                  target="_blank"
                  rel="noreferrer"
                  className="underline hover:text-foreground"
                >
                  Learn how →
                </a>
              </>
            )}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="binding-agent">Agent</Label>
        <Select value={agentId} onValueChange={setAgentId}>
          <SelectTrigger id="binding-agent">
            <SelectValue placeholder="Pick an agent" />
          </SelectTrigger>
          <SelectContent>
            {agentOptions.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.displayName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? 'Adding…' : 'Add binding'}
        </Button>
      </div>
    </form>
  );
}
