import 'server-only';

import type { Descriptor, DescriptorField } from './types';

/**
 * Serializable view of a descriptor that crosses the server/client
 * boundary. The runtime descriptor includes a server-only `probe`
 * function and (for channels) a `buildAdapter` factory — neither can
 * be sent to a client component. This helper extracts only the parts
 * the form UI needs.
 */
export type SerializableDescriptorField = Pick<
  DescriptorField,
  | 'name'
  | 'label'
  | 'type'
  | 'required'
  | 'secret'
  | 'helpUrl'
  | 'helpText'
  | 'placeholder'
  | 'defaultValue'
  | 'options'
  | 'showWhen'
>;

export function serializeFields(
  fields: Descriptor['fields'],
): SerializableDescriptorField[] {
  return fields.map((f) => ({
    name: f.name,
    label: f.label,
    type: f.type,
    required: f.required,
    secret: f.secret,
    helpUrl: f.helpUrl,
    helpText: f.helpText,
    placeholder: f.placeholder,
    defaultValue: f.defaultValue,
    options: f.options,
    showWhen: f.showWhen,
  }));
}
