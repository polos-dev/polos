import * as React from 'react';
import { cn } from '@/lib/utils';

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'min-h-[96px] w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm',
        'placeholder:text-gray-400 outline-none transition',
        'focus:border-black focus:ring-2 focus:ring-black/10',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'resize-y',
        className
      )}
      {...props}
    />
  )
);
Textarea.displayName = 'Textarea';
