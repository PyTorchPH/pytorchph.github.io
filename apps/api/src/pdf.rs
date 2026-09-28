use crate::{ApiError, ApiResult};
use axum::http::StatusCode;
use printpdf::{
    BuiltinFont, Mm, Op, PdfDocument, PdfFontHandle, PdfPage, PdfSaveOptions, Point, Pt, TextItem,
};

// Helvetica's built-in WinAnsi encoding cannot faithfully render arbitrary Unicode.
fn supported(character: char) -> bool {
    character == '\n'
        || character == '\r'
        || character == '\t'
        || (' '..='~').contains(&character)
        || ('\u{00a0}'..='\u{00ff}').contains(&character)
        || "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ".contains(character)
}

pub fn render(text: &str) -> ApiResult<Vec<u8>> {
    if text.is_empty() || text.len() > 20_000 || !text.chars().all(supported) {
        return Err(ApiError(
            StatusCode::BAD_REQUEST,
            "PDF text contains unsupported characters",
        ));
    }
    let mut lines = Vec::new();
    for paragraph in text.replace("\r\n", "\n").replace('\r', "\n").lines() {
        let mut line = String::new();
        for word in paragraph.split_whitespace() {
            if word.chars().count() > 92 {
                return Err(ApiError(
                    StatusCode::BAD_REQUEST,
                    "PDF word exceeds line width",
                ));
            }
            if line.chars().count() + word.chars().count() + usize::from(!line.is_empty()) > 92 {
                lines.push(std::mem::take(&mut line));
            }
            if !line.is_empty() {
                line.push(' ');
            }
            line.push_str(word);
        }
        lines.push(line);
    }
    let mut pages = Vec::new();
    for chunk in lines.chunks(48) {
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
        pages.push(PdfPage::new(Mm(210.0), Mm(297.0), ops));
    }
    let mut warnings = Vec::new();
    let bytes = PdfDocument::new("PyTorch PH approved attachment")
        .with_pages(pages)
        .save(&PdfSaveOptions::default(), &mut warnings);
    if !warnings.is_empty() || !bytes.starts_with(b"%PDF-") || bytes.len() > 1_000_000 {
        return Err(ApiError(
            StatusCode::UNPROCESSABLE_ENTITY,
            "PDF generation failed validation",
        ));
    }
    Ok(bytes)
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
