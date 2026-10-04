import { Button as BaseButton } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "../../lib/cn";

const buttonVariants = cva(
	"inline-flex items-center justify-center gap-2 rounded-md font-medium text-sm transition-colors disabled:pointer-events-none disabled:opacity-50",
	{
		variants: {
			variant: {
				primary:
					"bg-primary text-primary-foreground hover:bg-primary/90",
				outline: "border border-border bg-background hover:bg-muted",
			},
			size: {
				md: "h-10 px-4",
				sm: "h-8 px-3",
			},
		},
		defaultVariants: { variant: "primary", size: "md" },
	},
);

type ButtonProps = Omit<ComponentProps<typeof BaseButton>, "className"> &
	VariantProps<typeof buttonVariants> & { className?: string };

export function Button({ className, variant, size, ...props }: ButtonProps) {
	return (
		<BaseButton
			className={cn(buttonVariants({ variant, size }), className)}
			{...props}
		/>
	);
}
