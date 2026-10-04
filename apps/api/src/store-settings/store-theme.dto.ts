/**
 * Theme variables of the store, as CSS values. The keys are the CSS variables
 * of the UIs; a missing one keeps the UI default.
 */
export class StoreThemeDto {
	background?: string;
	foreground?: string;
	primary?: string;
	"primary-foreground"?: string;
	muted?: string;
	"muted-foreground"?: string;
	accent?: string;
	border?: string;
	destructive?: string;
	/** CSS length, such as `0.5rem`. */
	radius?: string;
}
