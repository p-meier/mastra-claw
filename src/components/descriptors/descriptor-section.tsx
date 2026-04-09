'use client';

import { useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/**
 * Wraps a category of descriptor cards (text providers, image+video,
 * tts, channels, …) with a header, an "Add" affordance, and a body
 * slot for the configured cards.
 *
 * Two flavors:
 *  - **Single-add**: One "Add" button that opens a dialog rendering
 *    the supplied form for a fixed descriptor id (used by channels —
 *    each channel has its own card and is "add-able" once).
 *  - **Picker-add**: A dropdown of available descriptor ids (used by
 *    providers — pick which provider to add when several exist in a
 *    category). Selecting from the dropdown opens the same dialog
 *    with the form for the picked id.
 */

export type AddOption = {
  id: string;
  label: string;
  /** Render the form for this option inside the dialog. */
  renderForm: (onClose: () => void) => ReactNode;
};

export type DescriptorSectionProps = {
  title: string;
  description?: string;
  /** The configured cards (one per existing instance). */
  children: ReactNode;
  /** Available "add new" options. Empty array hides the picker. */
  addOptions?: AddOption[];
  /** When true, the picker is rendered as a single button instead of a dropdown. */
  singleAdd?: boolean;
};

export function DescriptorSection({
  title,
  description,
  children,
  addOptions,
  singleAdd,
}: DescriptorSectionProps) {
  const [openOptionId, setOpenOptionId] = useState<string | null>(null);
  const activeOption = addOptions?.find((o) => o.id === openOptionId) ?? null;

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold tracking-tight">{title}</h2>
          {description && (
            <p className="text-sm text-muted-foreground">{description}</p>
          )}
        </div>
        {addOptions && addOptions.length > 0 && (
          <AddControl
            options={addOptions}
            singleAdd={singleAdd}
            onPick={(id) => setOpenOptionId(id)}
          />
        )}
      </header>

      <div className="grid gap-3 sm:grid-cols-2">{children}</div>

      <Dialog
        open={openOptionId !== null}
        onOpenChange={(open) => {
          if (!open) setOpenOptionId(null);
        }}
      >
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{activeOption?.label ?? 'Add'}</DialogTitle>
            <DialogDescription>
              Saving runs a connection probe and only persists if it succeeds.
            </DialogDescription>
          </DialogHeader>
          {activeOption?.renderForm(() => setOpenOptionId(null))}
        </DialogContent>
      </Dialog>
    </section>
  );
}

function AddControl({
  options,
  singleAdd,
  onPick,
}: {
  options: AddOption[];
  singleAdd?: boolean;
  onPick: (id: string) => void;
}) {
  if (singleAdd && options.length === 1) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onPick(options[0].id)}
      >
        Add {options[0].label}
      </Button>
    );
  }
  if (options.length === 1) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onPick(options[0].id)}
      >
        Add {options[0].label}
      </Button>
    );
  }
  return (
    <Select value="" onValueChange={onPick}>
      <SelectTrigger className="w-[200px]">
        <SelectValue placeholder="Add provider…" />
      </SelectTrigger>
      <SelectContent>
        {options.map((opt) => (
          <SelectItem key={opt.id} value={opt.id}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
