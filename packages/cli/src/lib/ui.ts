/**
 * UI Helper Library for Yellow Plugins CLI
 *
 * Provides ANSI-safe rendering utilities with graceful fallback for terminals
 * with limited capabilities. Implements the design system defined in
 * docs/ui/style-guide.md
 *
 * @module packages/cli/src/lib/ui
 * @see docs/ui/style-guide.md
 */

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface TerminalCapabilities {
	/** Supports ANSI color codes */
	hasColor: boolean;
	/** Color support level: 0=none, 1=16-color, 2=256-color, 3=truecolor */
	colorLevel: 0 | 1 | 2 | 3;
	/** Supports Unicode characters */
	hasUnicode: boolean;
	/** Is interactive terminal (TTY) */
	isTTY: boolean;
	/** Terminal width in columns */
	width: number;
}

export type ColorName =
	| 'primary'
	| 'secondary'
	| 'accent'
	| 'info'
	| 'warning'
	| 'danger'
	| 'neutralDark'
	| 'neutralMid'
	| 'neutralLight';

export type BadgeVariant = 'success' | 'warning' | 'error' | 'info';

export interface BoxOptions {
	/** Box title (displayed in top border) */
	title?: string;
	/** Box variant for styling */
	variant?: BadgeVariant;
	/** Padding inside box (number of spaces) */
	padding?: number;
	/** Minimum width (auto-expands based on content) */
	minWidth?: number;
}

// ============================================================================
// Color Definitions
// ============================================================================

/**
 * ANSI color code mappings from design system
 * @see docs/ui/style-guide.md#1-1-color-palette
 */
const ANSI_COLORS = {
	// 256-color codes (full support)
	primary256: '\x1b[38;5;220m', // Solar Citrine
	secondary256: '\x1b[38;5;54m', // Obsidian Violet
	accent256: '\x1b[38;5;41m', // Verdant Flux
	info256: '\x1b[38;5;74m', // Azure Relay
	warning256: '\x1b[38;5;214m', // Amber Pulse
	danger256: '\x1b[38;5;167m', // Signal Vermilion
	neutralDark256: '\x1b[38;5;235m', // Graphite
	neutralMid256: '\x1b[38;5;240m', // Slate
	neutralLight256: '\x1b[38;5;255m', // Fog

	// 16-color fallback codes
	primary16: '\x1b[93m', // Bright Yellow
	secondary16: '\x1b[35m', // Magenta
	accent16: '\x1b[92m', // Bright Green
	info16: '\x1b[94m', // Bright Blue
	warning16: '\x1b[33m', // Yellow
	danger16: '\x1b[91m', // Bright Red
	neutralDark16: '\x1b[30m', // Black
	neutralMid16: '\x1b[37m', // White
	neutralLight16: '\x1b[97m', // Bright White

	// Reset code
	reset: '\x1b[0m',
} as const;

/**
 * Hex color codes for reference (not used in terminal)
 */
const HEX_COLORS = {
	primary: '#F2C038', // Solar Citrine
	secondary: '#3A1956', // Obsidian Violet
	accent: '#2FBF71', // Verdant Flux
	info: '#4098D7', // Azure Relay
	warning: '#F29D35', // Amber Pulse
	danger: '#D64242', // Signal Vermilion
	neutralDark: '#1D1F21', // Graphite
	neutralMid: '#4C566A', // Slate
	neutralLight: '#ECEFF4', // Fog
} as const;

// ============================================================================
// Icon Definitions
// ============================================================================

/**
 * Unicode and ASCII icon mappings
 * @see docs/ui/style-guide.md#1-3-spacing-and-sizing
 */
const ICONS = {
	success: { unicode: '✔', ascii: '[OK]' },
	warning: { unicode: '⚠', ascii: '[WARN]' },
	error: { unicode: '✖', ascii: '[ERR]' },
	info: { unicode: 'ℹ', ascii: '[INFO]' },
	spinner: {
		unicode: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
		ascii: ['-', '\\', '|', '/'],
	},
} as const;

/**
 * Box-drawing characters
 */
const BOX_CHARS = {
	unicode: {
		topLeft: '┌',
		topRight: '┐',
		bottomLeft: '└',
		bottomRight: '┘',
		horizontal: '─',
		vertical: '│',
	},
	ascii: {
		topLeft: '+',
		topRight: '+',
		bottomLeft: '+',
		bottomRight: '+',
		horizontal: '-',
		vertical: '|',
	},
} as const;

// ============================================================================
// Capability Detection
// ============================================================================

let _cachedCapabilities: TerminalCapabilities | null = null;

/**
 * Detect terminal capabilities for adaptive rendering
 *
 * @returns Terminal capability information
 * @see docs/ui/style-guide.md#3-ansi-fallback
 */
export function detectTerminalCapabilities(): TerminalCapabilities {
	if (_cachedCapabilities) {
		return _cachedCapabilities;
	}

	const isTTY = process.stdout.isTTY ?? false;
	const term = (process.env.TERM || '').toLowerCase();
	const colorterm = (process.env.COLORTERM || '').toLowerCase();
	const termProgram = (process.env.TERM_PROGRAM || '').toLowerCase();
	const forceColor =
		process.env.FORCE_COLOR !== undefined && process.env.FORCE_COLOR !== '0';
	const noColor = process.env.NO_COLOR !== undefined && !forceColor;

	// Determine color support level
	let colorLevel: 0 | 1 | 2 | 3 = 0;
	if ((!noColor && isTTY) || forceColor) {
		if (
			colorterm.includes('truecolor') ||
			colorterm.includes('24bit') ||
			termProgram.includes('iterm')
		) {
			colorLevel = 3; // Truecolor
		} else if (
			term.includes('256') ||
			term.includes('xterm') ||
			term.includes('screen') ||
			forceColor
		) {
			colorLevel = 2; // 256-color
		} else if (term !== 'dumb' && term !== '') {
			colorLevel = 1; // 16-color
		}
	}

	// Test Unicode support (safe heuristic)
	const hasUnicode =
		!process.env.FORCE_ASCII &&
		(isTTY &&
			(process.env.LANG?.includes('UTF-8') ||
				process.env.LC_ALL?.includes('UTF-8') ||
				term.includes('xterm') ||
				termProgram.includes('apple'))) ||
		process.env.FORCE_UNICODE === '1';

	// Get terminal width
	const columns = process.stdout.columns ?? 80;
	const width = columns > 0 ? columns : 80;

	_cachedCapabilities = {
		hasColor: colorLevel > 0,
		colorLevel,
		hasUnicode,
		isTTY,
		width,
	};

	return _cachedCapabilities;
}

/**
 * Clear cached terminal capabilities (useful for testing)
 */
export function clearCapabilityCache(): void {
	_cachedCapabilities = null;
}

// ============================================================================
// Color Utilities
// ============================================================================

/**
 * Get ANSI color code for a color name
 *
 * @param color Color name from design system
 * @returns ANSI escape code or empty string if no color support
 */
function getColorCode(color: ColorName): string {
	const caps = detectTerminalCapabilities();

	if (!caps.hasColor) {
		return '';
	}

	const suffix = caps.colorLevel >= 2 ? '256' : '16';
	const key = `${color}${suffix}` as keyof typeof ANSI_COLORS;

	return ANSI_COLORS[key] || '';
}

/**
 * Colorize text with ANSI-safe fallback
 *
 * @param text Text to colorize
 * @param color Color name from design system
 * @returns Colorized text (or plain text if no color support)
 * @example
 * colorize('Success!', 'accent') // => '\x1b[38;5;41mSuccess!\x1b[0m'
 */
export function colorize(text: string, color: ColorName): string {
	const code = getColorCode(color);
	if (!code) {
		return text;
	}
	return `${code}${text}${ANSI_COLORS.reset}`;
}

// ============================================================================
// Icon Utilities
// ============================================================================

/**
 * Get icon character for a badge variant
 *
 * @param variant Badge variant
 * @returns Icon character (Unicode or ASCII fallback)
 */
function getIcon(variant: BadgeVariant): string {
	const caps = detectTerminalCapabilities();
	const iconMap: Record<BadgeVariant, keyof typeof ICONS> = {
		success: 'success',
		warning: 'warning',
		error: 'error',
		info: 'info',
	};

	const iconKey = iconMap[variant];
	const icon = ICONS[iconKey];

	return caps.hasUnicode ? icon.unicode : icon.ascii;
}

// ============================================================================
// Heading Rendering
// ============================================================================

/**
 * Render a formatted heading with color and weight
 *
 * @param text Heading text
 * @param level Heading level (1-3)
 * @returns Formatted heading string
 * @example
 * renderHeading('Installation', 1) // => '\x1b[38;5;220mInstallation\x1b[0m'
 * @see docs/ui/style-guide.md#1-2-typography
 */
export function renderHeading(text: string, level: 1 | 2 | 3): string {
	const colorMap: Record<1 | 2 | 3, ColorName> = {
		1: 'primary',
		2: 'secondary',
		3: 'info',
	};
	const decorationMapUnicode: Record<1 | 2 | 3, string> = {
		1: '═',
		2: '─',
		3: '',
	};
	const decorationMapAscii: Record<1 | 2 | 3, string> = {
		1: '=',
		2: '-',
		3: '',
	};

	const caps = detectTerminalCapabilities();
	const lines = wrapText(text, 72);
	const plainHeading = lines.join('\n');
	const coloredHeading = colorize(plainHeading, colorMap[level]);

	const decorationChar = caps.hasUnicode
		? decorationMapUnicode[level]
		: decorationMapAscii[level];

	if (!decorationChar) {
		return coloredHeading;
	}

	const underlineWidth = Math.max(
		3,
		...lines.map((line) => visibleLength(line)),
	);
	const underline = decorationChar.repeat(underlineWidth);
	const coloredUnderline = colorize(underline, colorMap[level]);

	return `${coloredHeading}\n${coloredUnderline}`;
}

// ============================================================================
// Badge Rendering
// ============================================================================

/**
 * Render a colored badge with icon
 *
 * @param text Badge text
 * @param variant Badge variant for styling
 * @returns Formatted badge string
 * @example
 * renderBadge('Completed', 'success') // => '✔ Completed' (colored green)
 * @see docs/ui/style-guide.md#1-1-color-palette
 */
export function renderBadge(text: string, variant: BadgeVariant): string {
	const colorMap: Record<BadgeVariant, ColorName> = {
		success: 'accent',
		warning: 'warning',
		error: 'danger',
		info: 'info',
	};

	const icon = getIcon(variant);
	const coloredText = colorize(`${icon} ${text}`, colorMap[variant]);

	return coloredText;
}

// ============================================================================
// Box Rendering
// ============================================================================

/**
 * Render a text box with borders
 *
 * @param content Box content (may contain newlines)
 * @param options Box styling options
 * @returns Formatted box string with borders
 * @example
 * renderBox('Important message', { title: 'Alert', variant: 'warning' })
 * @see docs/ui/style-guide.md#1-4-component-tokens
 */
export function renderBox(content: string, options: BoxOptions = {}): string {
	const { title, variant, padding = 1, minWidth = 40 } = options;
	const caps = detectTerminalCapabilities();
	const availableWidth = Math.max(20, caps.width - 4);
	const maxWidth = Math.min(availableWidth, 72);
	const safePadding = Math.max(
		0,
		Math.min(padding, Math.floor((maxWidth - 2) / 2)),
	);
	const contentLines = content.split('\n');
	const normalizedTitle = title?.trim() ?? '';

	// Select box-drawing characters
	const chars = caps.hasUnicode ? BOX_CHARS.unicode : BOX_CHARS.ascii;

	const longestLine = Math.max(...contentLines.map((line) => visibleLength(line)));
	const baseInnerWidth = Math.max(
		10,
		minWidth,
		longestLine + safePadding * 2,
		normalizedTitle ? visibleLength(normalizedTitle) + 2 : 0,
	);
	const innerWidth = Math.min(baseInnerWidth, maxWidth);
	const contentWidth = Math.max(1, innerWidth - safePadding * 2);

	// Build top border
	let topBorder = chars.topLeft;
	if (normalizedTitle && innerWidth > 4) {
		const maxTitleLength = Math.max(0, innerWidth - 2);
		const titleText =
			normalizedTitle.length > maxTitleLength
				? normalizedTitle.slice(0, maxTitleLength)
				: normalizedTitle;
		const decoratedTitle = ` ${titleText} `;
		const remainingWidth = Math.max(0, innerWidth - decoratedTitle.length);
		const leftWidth = Math.floor(remainingWidth / 2);
		const rightWidth = remainingWidth - leftWidth;
		topBorder +=
			chars.horizontal.repeat(leftWidth) +
			decoratedTitle +
			chars.horizontal.repeat(rightWidth);
	} else {
		topBorder += chars.horizontal.repeat(innerWidth);
	}
	topBorder += chars.topRight;

	// Apply variant coloring to top border
	if (variant) {
		const colorMap: Record<BadgeVariant, ColorName> = {
			success: 'accent',
			warning: 'warning',
			error: 'danger',
			info: 'info',
		};
		topBorder = colorize(topBorder, colorMap[variant]);
	}

	// Wrap lines when they contain no ANSI codes and exceed available width
	const expandedLines: string[] = [];
	for (const line of contentLines) {
		const hasAnsi = stripAnsi(line) !== line;
		const hasIndent = /^\s/.test(line);
		if (!hasAnsi && !hasIndent && visibleLength(line) > contentWidth) {
			expandedLines.push(...wrapText(line, contentWidth));
		} else {
			expandedLines.push(line);
		}
	}

	// Build content lines
	const paddedLines = expandedLines.map((line) => {
		const paddingLeft = ' '.repeat(safePadding);
		const lineLength = visibleLength(line);
		const fillerWidth = Math.max(0, contentWidth - lineLength);
		const filler = ' '.repeat(fillerWidth);
		return `${chars.vertical}${paddingLeft}${line}${filler}${paddingLeft}${chars.vertical}`;
	});

	// Build bottom border
	const bottomBorder =
		chars.bottomLeft + chars.horizontal.repeat(innerWidth) + chars.bottomRight;

	// Assemble box
	return [topBorder, ...paddedLines, bottomBorder].join('\n');
}

// ============================================================================
// Progress Rendering
// ============================================================================

/**
 * Render a progress bar with percentage
 *
 * @param current Current progress value
 * @param total Total value (100%)
 * @returns Formatted progress bar string
 * @example
 * renderProgress(3, 10) // => '[###-------] 30%'
 * @see docs/ui/style-guide.md#6-1-progress-feedback
 */
export function renderProgress(current: number, total: number): string {
	const safeTotal = total <= 0 ? 1 : total;
	const safeCurrent = Math.min(Math.max(current, 0), safeTotal);
	const percentage = Math.round((safeCurrent / safeTotal) * 100);
	const barWidth = 20;
	const filledWidth = Math.round((barWidth * safeCurrent) / safeTotal);

	const caps = detectTerminalCapabilities();
	const filledChar = caps.hasUnicode ? '█' : '#';
	const emptyChar = caps.hasUnicode ? '░' : '-';

	const filled = filledChar.repeat(filledWidth);
	const empty = emptyChar.repeat(barWidth - filledWidth);

	return `[${filled}${empty}] ${percentage}%`;
}

// ============================================================================
// Spinner Rendering
// ============================================================================

/**
 * Get spinner frame for animation
 *
 * @param frame Frame number (cycles through available frames)
 * @returns Single spinner frame character
 * @example
 * renderSpinner(0) // => '⠋' (or '-' for ASCII)
 * @see docs/ui/style-guide.md#1-4-component-tokens
 */
export function renderSpinner(frame: number): string {
	const caps = detectTerminalCapabilities();
	const frames = caps.hasUnicode
		? ICONS.spinner.unicode
		: ICONS.spinner.ascii;

	const index = frame % frames.length;
	return colorize(frames[index], 'info');
}

// ============================================================================
// Line Wrapping Utilities
// ============================================================================

/**
 * Wrap text to maximum line length
 *
 * @param text Text to wrap
 * @param maxWidth Maximum line width (default: 72)
 * @returns Array of wrapped lines
 * @see docs/ui/style-guide.md#1-2-typography
 */
export function wrapText(text: string, maxWidth: number = 72): string[] {
	const words = text.split(/\s+/);
	const lines: string[] = [];
	let currentLine = '';

	for (const word of words) {
		if (currentLine.length + word.length + 1 <= maxWidth) {
			currentLine += (currentLine ? ' ' : '') + word;
		} else {
			if (currentLine) {
				lines.push(currentLine);
			}
			currentLine = word;
		}
	}

	if (currentLine) {
		lines.push(currentLine);
	}

	return lines;
}

// ============================================================================
// Accessibility Utilities
// ============================================================================

/**
 * Strip ANSI color codes from text
 *
 * Useful for:
 * - Screen reader compatibility
 * - Plain text exports
 * - Length calculations
 *
 * @param text Text with ANSI codes
 * @returns Plain text without ANSI codes
 */
export function stripAnsi(text: string): string {
	// eslint-disable-next-line no-control-regex
	return text.replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * Get visible text length (excluding ANSI codes)
 *
 * @param text Text with potential ANSI codes
 * @returns Visible character count
 */
export function visibleLength(text: string): number {
	return stripAnsi(text).length;
}

// ============================================================================
// Exports
// ============================================================================

export {
	ANSI_COLORS,
	HEX_COLORS,
	ICONS,
	BOX_CHARS,
	getColorCode,
	getIcon,
};
