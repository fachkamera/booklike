/** Minimum natural resolution for an image to be kept. */
export const MIN_NATURAL_RESOLUTION = 10_000

/** Minimum rendered resolution for an image to be kept. */
export const MIN_RENDERED_RESOLUTION = 100_000

/** Maximum aspect ratio for an image to be kept. */
export const EXTREME_ASPECT_RATIO = 5

/** Preferred minimum width (px) when selecting a JPEG/PNG source for EPUB export. */
export const EPUB_IMAGE_MIN_WIDTH = 800

/** Maximum time (ms) to wait for JS-rendered content to appear before proceeding with extraction. */
export const JS_RENDER_WAIT_TIMEOUT = 2_000

/** Maximum time (ms) to wait for images to load before proceeding with extraction. */
export const IMAGE_LOAD_TIMEOUT = 5_000

/** Settle delay (ms) after images load — allows page JS handlers and CSS transitions to complete. */
export const IMAGE_LOAD_SETTLE_MS = 150

/** Minimum word count for extracted article content to be considered readable. */
export const MIN_ARTICLE_WORD_COUNT = 50

/** Maximum fraction of the article's text an element may hold before it's considered unsafe to remove. */
export const SAFE_REMOVE_MAX_TEXT_FRACTION = 0.25

/** Maximum character length of a single breadcrumb link's text. */
export const BREADCRUMB_MAX_LINK_TEXT = 60

/** Maximum total text length of a breadcrumb container per link. */
export const BREADCRUMB_MAX_CONTAINER_TEXT_PER_LINK = 80

/** Maximum text length of a timestamp ancestor element to be considered metadata. */
export const SHARE_BYLINE_MAX_ANCESTOR_TEXT = 300

/** Maximum text length for a rubric/kicker/eyebrow label element to be removed. */
export const RUBRIC_MAX_TEXT_CHARS = 50

/** Minimum length of loose text inside a figure (outside its caption) to be pulled into the caption rather than discarded. */
export const FIGURE_LOOSE_TEXT_MIN_CHARS = 12

/** Maximum non-link prose chars in a "Further Reading" / "See Also" sibling paragraph  */
export const RELATED_SECTION_MAX_PROSE_CHARS = 50

/** Minimum word overlap fraction for a heading/paragraph to be considered a duplicate of the article (sub-)title. */
export const REDUNDANT_HEADING_OVERLAP_THRESHOLD = 0.6

/** Minimum word overlap fraction for a heading to be considered a variant of an already-removed heading. */
export const VARIANT_HEADING_OVERLAP_THRESHOLD = 0.75

/** Number of chars compared at the start/end of two strings to detect shared phrasing. */
export const EDGE_COMPARISON_CHARS = 20

/** Max number of leading paragraphs to check for title/subtitle repetition. */
export const LEADING_PARA_CHECK_LIMIT = 3

/** Max ratio of paragraph length to reference (title/subtitle) length for word-overlap redundancy checks. */
export const REDUNDANT_PARA_LENGTH_RATIO = 2

/** Words with length ≤ this value are excluded from word overlap calculations (stop words). */
export const OVERLAP_WORD_LENGTH_THRESHOLD = 2

/** Max char length of a text node for loose date detection to apply. */
export const META_TEXT_MAX_CHARS = 80

/** Max non-link chars in a single-link paragraph before it's kept as real content. */
export const SINGLE_LINK_PARA_MAX_NONLINK_CHARS = 3

/** Max char length of a paragraph for cross-article deduplication. */
export const DEDUP_ATTRIBUTION_MAX_CHARS = 60

/** Max number of author names to display before truncating with "et al." */
export const MAX_BYLINE_AUTHORS = 3

/** Minimum character length of a selected word to trigger dictionary lookup. */
export const DICT_MIN_CHARS = 2

/** Parts of speech shown per dictionary entry; the rest are dropped as long-tail senses. */
export const DICT_MAX_POS = 3

/** Gap (px) between the selected word and the dictionary popover. */
export const DICT_POPOVER_GAP_PX = 8

/** Minimum distance (px) the dictionary popover keeps from the viewport edges. */
export const DICT_POPOVER_VIEWPORT_MARGIN_PX = 8

/**
 * Height (px) the dictionary popover falls back to when neither side of the selection
 * has room for it, as in a very short window.
 */
export const DICT_POPOVER_MIN_HEIGHT_PX = 120

/**
 * Base URL of the self-hosted pronunciation recordings. Keys are `<word>.opus`
 */
export const DICT_AUDIO_BASE = 'https://audio.booklike.app/v1/en/'

/**
 * Credits page for a recording.
 */
export const DICT_CREDITS_BASE = 'https://booklike.app/credits#'

/** Speech rate for the speechSynthesis pronunciation fallback (1 = normal). */
export const DICT_SPEECH_RATE = 0.9

/**
 * Time (ms) the service worker gives a pronunciation download before aborting.
 */
export const DICT_AUDIO_FETCH_TIMEOUT_MS = 8000

/** Max time (ms) the pronunciation button stays locked before accepting clicks again. */
export const DICT_AUDIO_MAX_MS = 10000

/**
 * Time (ms) allowed to get pronunciation audio playing before falling back to speech
 * synthesis.
 */
export const DICT_AUDIO_DEADLINE_MS = 4000

/**
 * Time (ms) a pronunciation click may stay pending before the button shows its loading
 * state.
 */
export const DICT_AUDIO_LOADING_DELAY_MS = 150

/** Time (ms) allowed for speech synthesis to actually start before the button unlocks. */
export const DICT_SPEECH_START_MS = 1000

/** Time (ms) to wait for beforeprint event before assuming print was blocked by CSP sandbox. */
export const PRINT_SANDBOX_DETECT_MS = 300

/** Duration (ms) for the "use keyboard shortcut to print" toast. */
export const PRINT_TOAST_DURATION_MS = 3_000

/** Monthly limit for EPUB downloads that include images. */
export const EPUB_IMAGE_QUOTA_MONTHLY = 10

/** Show remaining-quota hint when usage reaches this count. */
export const EPUB_IMAGE_QUOTA_WARN_AT = 5

/** Articles with more images than this skip image embedding entirely (too heavy for EPUB). */
export const EPUB_MAX_ARTICLE_IMAGES = 10

/** Number of wheel delta samples to keep for momentum/gesture detection. */
export const WHEEL_DELTA_BUFFER_SIZE = 150

/** Minimum gap (ms) between wheel events to treat the next event as a fresh gesture. */
export const WHEEL_FRESH_GESTURE_GAP_MS = 200

/** Horizontal gap (px) between the menu bar and an open submenu panel. */
export const PANEL_GAP_PX = 8

/** Minimum distance (px) an open submenu panel keeps from the viewport edges. */
export const PANEL_VIEWPORT_PAD_PX = 16

/** Grace period (ms) after reader activation during which a tab reload won't deactivate the reader. */
export const READER_ACTIVATION_GRACE_MS = 3000

/** Base URL for per-version release notes; the manifest version tag is appended. */
export const RELEASE_NOTES_URL = 'https://github.com/fachkamera/booklike/releases/tag/'
