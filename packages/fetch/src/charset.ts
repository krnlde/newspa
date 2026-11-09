/**
 * The charset is the transport's job, because `parsePayload`'s own contract says
 * so: "text is the **decoded** body: the transport layer owns the charset".
 *
 * The order of authority is fixed, and it is a security-relevant one:
 * `Content-Type; charset=` → default UTF-8. An `<?xml encoding="…">` declaration
 * is **reported in the notes and never obeyed** — a document that declares its
 * own encoding can lie about bytes that were decoded as something else, which is
 * the class of bug that turns a UTF-8 payload into mojibake, and the reason
 * browsers gate a document-level encoding declaration behind a same-origin sniffer
 * rule. A declared label is a fact to print, not an instruction to follow.
 */

/**
 * `text/html; charset="ISO-8859-1"` → `iso-8859-1`. `null` when the header names
 * none, or names one with nothing after the `=`.
 */
export const charsetFromContentType = (contentType: string | null): string | null => {
  if (contentType === null) return null;
  const parameter = contentType
    .split(';')
    .map((part) => part.trim().toLowerCase())
    .find((part) => part.startsWith('charset='));
  if (parameter === undefined) return null;
  const label = parameter.slice('charset='.length).replaceAll('"', '').replaceAll("'", '').trim();
  return label.length === 0 ? null : label;
};

/** The media type without its parameters: `application/rss+xml`. */
export const mediaTypeOf = (contentType: string | null): string | null => {
  if (contentType === null) return null;
  const at = contentType.indexOf(';');
  const head = (at === -1 ? contentType : contentType.slice(0, at)).trim().toLowerCase();
  return head.length === 0 ? null : head;
};

/**
 * The `encoding=` of the XML prolog, searched in the first 200 characters (the
 * prolog must start at byte 0 of the document; 200 covers `version`,
 * `standalone` and a long label). `null` = no declaration.
 */
export const xmlDeclaredCharset = (text: string): string | null => {
  const head = text.slice(0, 200);
  const prolog = head.indexOf('<?xml');
  if (prolog === -1) return null;
  const end = head.indexOf('?>', prolog);
  const declaration = head.slice(prolog, end === -1 ? head.length : end + 2);
  const match = /encoding\s*=\s*["']?\s*([A-Za-z0-9._:-]+)\s*["']?/.exec(declaration);
  const value = match?.[1];
  return value === undefined ? null : value.toLowerCase();
};

/** Labels that name the same bytes, so a note is not printed for `utf8` vs `utf-8`. */
const CANONICAL: Readonly<Record<string, string>> = {
  utf8: 'utf-8',
  u8: 'utf-8',
  us_ascii: 'us-ascii',
  ascii: 'us-ascii',
  latin1: 'iso-8859-1',
  '8859': 'iso-8859-1',
  'iso8859-1': 'iso-8859-1',
  cp1252: 'windows-1252',
  'x-cp1252': 'windows-1252',
};

const canonical = (label: string): string => CANONICAL[label] ?? label;

/** Is this label one the runtime's `TextDecoder` knows? An unknown label is a `RangeError`. */
const decoderFor = (label: string): TextDecoder | null => {
  try {
    return new TextDecoder(label);
  } catch {
    return null;
  }
};

export interface DecodedBody {
  readonly text: string;
  /** The label actually decoded with, lower-cased. */
  readonly charset: string;
  /** The encoding the XML prolog declared, when it declared one. */
  readonly declaredCharset: string | null;
  readonly notes: readonly string[];
}

/**
 * Decode bytes to text. UTF-8 is the default when the header says nothing
 * (measured: a feed served as `text/html` carries no `charset` at all), and an
 * undecodable label is a **note**, not a silent substitution: the paper can
 * print mojibake, and the note is what makes it explainable.
 */
export const decodeBody = (bytes: Uint8Array, contentType: string | null): DecodedBody => {
  const declared = charsetFromContentType(contentType);
  const notes: string[] = [];
  let charset = declared ?? 'utf-8';
  let decoder = decoderFor(charset);
  if (decoder === null) {
    notes.push(
      `the content-type charset '${charset}' is not a label this runtime can decode: decoded as UTF-8, so non-ASCII text may be mojibake`,
    );
    // UTF-8 is in every WHATWG implementation, so this construction cannot fail.
    charset = 'utf-8';
    decoder = new TextDecoder('utf-8');
  }
  const text = decoder.decode(bytes);
  if (declared === null) notes.push('no charset in content-type: decoded as UTF-8 (the default)');
  const declaredXml = xmlDeclaredCharset(text);
  if (declaredXml !== null && canonical(declaredXml) !== canonical(charset)) {
    notes.push(
      `the XML prolog declares encoding="${declaredXml}" while the bytes were decoded as ${charset}: reported, not obeyed (parsePayload's contract)`,
    );
  }
  return { text, charset, declaredCharset: declaredXml, notes };
};
