//! Renders approved plain text into a small, validated A4 PDF.
//!
//! Module map (caller-first):
//!   render                 text → checked PDF bytes
//!   ├─ is_renderable_text  non-empty, bounded, only characters Helvetica can encode
//!   ├─ wrap_lines          word-wraps paragraphs at 92 characters
//!   │   └─ wrap_paragraph
//!   ├─ page_for            48 lines of 11 pt Helvetica per page
//!   └─ is_valid_pdf        no warnings, a PDF header, under 1 MB
use crate::{ApiError, ApiResult};
use axum::http::StatusCode;
use printpdf::{
    BuiltinFont, Mm, Op, PdfDocument, PdfFontHandle, PdfPage, PdfSaveOptions, Point, Pt, TextItem,
};

const MAX_TEXT_LENGTH: usize = 20_000;
const LINE_WIDTH: usize = 92;
const LINES_PER_PAGE: usize = 48;
const MAX_PDF_BYTES: usize = 1_000_000;

/// Mental model: reject what cannot be rendered faithfully, wrap into lines, lay lines out
/// page by page, then refuse any output that does not look like a clean PDF.
pub fn render(text: &str) -> ApiResult<Vec<u8>> {
    if !is_renderable_text(text) {
        return Err(ApiError(
            StatusCode::BAD_REQUEST,
            "PDF text contains unsupported characters",
        ));
    }
    let lines = wrap_lines(text)?;
    let pages = lines.chunks(LINES_PER_PAGE).map(page_for).collect();
    let mut warnings = Vec::new();
    let bytes = PdfDocument::new("PyTorch PH approved attachment")
        .with_pages(pages)
        .save(&PdfSaveOptions::default(), &mut warnings);
    if !is_valid_pdf(&bytes, &warnings) {
        return Err(ApiError(
            StatusCode::UNPROCESSABLE_ENTITY,
            "PDF generation failed validation",
        ));
    }
    Ok(bytes)
}

#[inline]
fn is_renderable_text(text: &str) -> bool {
    !text.is_empty() && text.len() <= MAX_TEXT_LENGTH && text.chars().all(supported)
}

// Helvetica's built-in WinAnsi encoding cannot faithfully render arbitrary Unicode.
#[inline]
fn supported(character: char) -> bool {
    character == '\n'
        || character == '\r'
        || character == '\t'
        || (' '..='~').contains(&character)
        || ('\u{00a0}'..='\u{00ff}').contains(&character)
        || "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ".contains(character)
}

fn wrap_lines(text: &str) -> ApiResult<Vec<String>> {
    let mut lines = Vec::new();
    for paragraph in text.replace("\r\n", "\n").replace('\r', "\n").lines() {
        wrap_paragraph(paragraph, &mut lines)?;
    }
    Ok(lines)
}

fn wrap_paragraph(paragraph: &str, lines: &mut Vec<String>) -> ApiResult<()> {
    let mut line = String::new();
    for word in paragraph.split_whitespace() {
        if word.chars().count() > LINE_WIDTH {
            return Err(ApiError(
                StatusCode::BAD_REQUEST,
                "PDF word exceeds line width",
            ));
        }
        if would_overflow(&line, word) {
            lines.push(std::mem::take(&mut line));
        }
        if !line.is_empty() {
            line.push(' ');
        }
        line.push_str(word);
    }
    lines.push(line);
    Ok(())
}

#[inline]
fn would_overflow(line: &str, word: &str) -> bool {
    line.chars().count() + word.chars().count() + usize::from(!line.is_empty()) > LINE_WIDTH
}

fn page_for(chunk: &[String]) -> PdfPage {
    let mut ops = vec![
        Op::StartTextSection,
        Op::SetTextCursor {
            pos: Point::new(Mm(20.0), Mm(275.0)),
        },
        Op::SetLineHeight { lh: Pt(15.0) },
        Op::SetFont {
            font: PdfFontHandle::Builtin(BuiltinFont::Helvetica),
            size: Pt(11.0),
        },
    ];
    for line in chunk {
        ops.push(Op::ShowText {
            items: vec![TextItem::Text(line.clone())],
        });
        ops.push(Op::AddLineBreak);
    }
    ops.push(Op::EndTextSection);
    PdfPage::new(Mm(210.0), Mm(297.0), ops)
}

#[inline]
fn is_valid_pdf<W>(bytes: &[u8], warnings: &[W]) -> bool {
    warnings.is_empty() && bytes.starts_with(b"%PDF-") && bytes.len() <= MAX_PDF_BYTES
}

#[cfg(test)]
mod tests {
    use super::render;

    #[test]
    fn renders_bounded_attachment_and_rejects_unsupported_text() {
        let pdf = render("PyTorch PH\nApproved evidence: niñez").unwrap();
        assert!(pdf.starts_with(b"%PDF-"));
        assert!(pdf.len() < 1_000_000);
        assert!(render("Unsupported: 🚀").is_err());
    }
}
