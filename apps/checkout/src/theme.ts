/** CSS variables of the theme, defined with the Feitio defaults in styles.css. */
export const themeVariables = [
	"background",
	"foreground",
	"primary",
	"primary-foreground",
	"muted",
	"muted-foreground",
	"accent",
	"border",
	"destructive",
	"radius",
] as const;

export type ThemeVariable = (typeof themeVariables)[number];

/** A tenant's theme. Variables left out keep the Feitio defaults. */
export type Theme = Partial<Record<ThemeVariable, string>>;

/**
 * The single place where the tenant's theme overrides the default palette.
 * Values go to CSS variables on <html>, so every theme class picks them up.
 */
export function applyTheme(
	theme: Theme,
	root: HTMLElement = document.documentElement,
) {
	for (const name of themeVariables) {
		const value = theme[name];
		if (value) {
			root.style.setProperty(`--${name}`, value);
		}
	}
}
