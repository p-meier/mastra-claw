'use client';

import { useState, useTransition, type ReactNode } from 'react';

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

/**
 * Generic card for one configured descriptor instance — a provider in
 * a category, or a channel. Presentational only: the parent owns the
 * "edit", "delete", and "set active" callbacks. The card renders the
 * edit dialog inline so the body can be the shared
 * `descriptor-config-form` for the provider/channel registry.
 */

export type DescriptorCardProps = {
  title: string;
  description?: string;
  /** True iff this is the active instance in its category. */
  isActive?: boolean;
  /**
   * Render the edit form. The callback receives an `onClose` function
   * the form should call after a successful save so the dialog can
   * dismiss itself. The previous version of this component took a
   * static `ReactNode` slot, which left the form with no way to
   * signal completion — saves succeeded but the dialog stayed open
   * forever. Mirrors the `renderForm` pattern used by
   * `DescriptorSection`.
   */
  renderEditForm: (onClose: () => void) => ReactNode;
  /** Slot for additional inline controls (e.g. voice toggle). */
  inlineControls?: ReactNode;
  onSetActive?: () => Promise<{ ok: boolean; error?: string }>;
  onDelete?: () => Promise<{ ok: boolean; error?: string }>;
  /** Hides the "Set active" button when not applicable (e.g. channels). */
  showSetActive?: boolean;
};

export function DescriptorCard({
  title,
  description,
  isActive,
  renderEditForm,
  inlineControls,
  onSetActive,
  onDelete,
  showSetActive = true,
}: DescriptorCardProps) {
  const [editOpen, setEditOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSetActive(): void {
    if (!onSetActive) return;
    startTransition(async () => {
      const r = await onSetActive();
      if (!r.ok) setError(r.error ?? 'Failed to set active');
      else setError(null);
    });
  }

  function handleDelete(): void {
    if (!onDelete) return;
    if (!confirm(`Delete ${title} configuration? This cannot be undone.`)) return;
    startTransition(async () => {
      const r = await onDelete();
      if (!r.ok) setError(r.error ?? 'Failed to delete');
      else setError(null);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {title}
          {isActive && <Badge>Active</Badge>}
        </CardTitle>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {inlineControls}
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setEditOpen(true)}
          >
            Edit
          </Button>
          {showSetActive && !isActive && onSetActive && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={handleSetActive}
            >
              Set active
            </Button>
          )}
          {onDelete && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending || isActive}
              onClick={handleDelete}
            >
              Delete
            </Button>
          )}
        </div>
      </CardContent>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              Update credentials and configuration. Saving runs a connection
              probe and only persists if it succeeds.
            </DialogDescription>
          </DialogHeader>
          {renderEditForm(() => setEditOpen(false))}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
