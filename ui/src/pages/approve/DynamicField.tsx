import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export interface FormField {
  name: string;
  type: string;
  label?: string;
  description?: string;
  required?: boolean;
  default?: unknown;
  options?: { label: string; value: string }[];
}

interface DynamicFieldProps {
  field: FormField;
  value: unknown;
  onChange: (name: string, value: unknown) => void;
}

export function DynamicField({ field, value, onChange }: DynamicFieldProps) {
  const label = field.label || field.name;

  switch (field.type) {
    case 'boolean':
      return (
        <div className="flex items-center justify-between gap-3">
          <div>
            <Label>{label}</Label>
            {field.description && (
              <p className="text-xs text-gray-500 mt-0.5">
                {field.description}
              </p>
            )}
          </div>
          <Switch
            checked={Boolean(value)}
            onCheckedChange={(checked) => onChange(field.name, checked)}
          />
        </div>
      );

    case 'select':
      return (
        <div className="space-y-1.5">
          <Label>
            {label}
            {field.required && <span className="text-red-500 ml-0.5">*</span>}
          </Label>
          {field.description && (
            <p className="text-xs text-gray-500">{field.description}</p>
          )}
          <Select
            value={String(value ?? '')}
            onValueChange={(v) => onChange(field.name, v)}
          >
            <SelectTrigger className="!h-10 w-full">
              <SelectValue placeholder="Select..." />
            </SelectTrigger>
            <SelectContent>
              {(field.options || []).map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      );

    case 'textarea':
      return (
        <div className="space-y-1.5">
          <Label>
            {label}
            {field.required && <span className="text-red-500 ml-0.5">*</span>}
          </Label>
          {field.description && (
            <p className="text-xs text-gray-500">{field.description}</p>
          )}
          <Textarea
            value={String(value ?? '')}
            onChange={(e) => onChange(field.name, e.target.value)}
            required={field.required}
          />
        </div>
      );

    case 'number':
      return (
        <div className="space-y-1.5">
          <Label>
            {label}
            {field.required && <span className="text-red-500 ml-0.5">*</span>}
          </Label>
          {field.description && (
            <p className="text-xs text-gray-500">{field.description}</p>
          )}
          <Input
            type="number"
            value={value === undefined || value === null ? '' : String(value)}
            onChange={(e) =>
              onChange(
                field.name,
                e.target.value === '' ? '' : Number(e.target.value)
              )
            }
            required={field.required}
          />
        </div>
      );

    // text, email, url, and fallback
    default: {
      const inputType = ['text', 'email', 'url'].includes(field.type)
        ? field.type
        : 'text';
      return (
        <div className="space-y-1.5">
          <Label>
            {label}
            {field.required && <span className="text-red-500 ml-0.5">*</span>}
          </Label>
          {field.description && (
            <p className="text-xs text-gray-500">{field.description}</p>
          )}
          <Input
            type={inputType}
            value={String(value ?? '')}
            onChange={(e) => onChange(field.name, e.target.value)}
            required={field.required}
          />
        </div>
      );
    }
  }
}
