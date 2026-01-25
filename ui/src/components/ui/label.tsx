import * as React from 'react';
import * as RadixLabel from '@radix-ui/react-label';
import { cn } from '@/lib/utils';

export type LabelProps = React.ComponentPropsWithoutRef<typeof RadixLabel.Root>;

export const Label = React.forwardRef<
  React.ComponentRef<typeof RadixLabel.Root>,
  LabelProps
>(({ className, ...props }, ref) => (
  <RadixLabel.Root
    ref={ref}
    className={cn('text-sm font-medium text-gray-700', className)}
    {...props}
  />
));
Label.displayName = 'Label';
