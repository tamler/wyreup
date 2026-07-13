// AUTO-GENERATED job landing-page content. Edit via the content pipeline, not ad hoc.

export interface JobSeoContent {
  intro: string;
  useCases: string[];
  faq: { q: string; a: string }[];
}

export const JOB_SEO_CONTENT: Record<string, JobSeoContent> = {
  'compress-photo-for-email': {
    intro:
      'Make a photo small enough to attach to an email without giving the recipient a blurry mess. Large phone and camera images can exceed an email provider\'s attachment limit even when only one picture is being sent. This job reduces the image data while keeping enough detail for normal viewing, so the finished copy is easier to attach and quicker to receive. It runs in your browser, and the photo stays on your computer while this compression job is working. The result is a separate file, leaving the original available if a larger version is needed later. Actual savings depend on the source image, its dimensions, and how heavily it was already compressed.',
    useCases: [
      'Reduce a phone photo before attaching it to a message for family or friends.',
      'Make several product photos easier to send to a customer by email.',
      'Shrink a picture that an email service rejects as too large.',
      'Create a smaller copy of an event photo while keeping the full-size original.',
    ],
    faq: [
      {
        q: 'Will the compressed photo look worse?',
        a: 'Compression removes some image data, so very strong compression can soften fine detail. For ordinary email viewing, a moderate reduction usually gives a useful balance between appearance and file size.',
      },
      {
        q: 'Does this change my original photo?',
        a: 'No. The job creates a new compressed file for download, so the source photo remains available on your device.',
      },
      {
        q: 'Why is my photo still too large for email?',
        a: 'Attachment limits vary by email provider, and very large images may need another pass or smaller dimensions. Check the downloaded file size against the limit shown by the email service.',
      },
      {
        q: 'Can I compress a photo from my phone?',
        a: 'Yes, if the browser can open the image format. Select the photo in the browser, run the job, then attach the downloaded copy to the email.',
      },
    ],
  },
  'convert-heic-to-jpg': {
    intro:
      'Turn an iPhone HEIC photo into a JPG that Windows computers, websites, and older apps are more likely to open. HEIC saves space well, but it is still rejected by some upload forms and unfamiliar to people using older software. This conversion creates a broadly compatible JPG copy for sharing or uploading while preserving the original HEIC file. The selected photo is converted in your browser and stays on the device during this job. JPG does not support every HEIC feature, and conversion can change file size or discard format-specific data, but the visible image is prepared for everyday use in programs that expect JPEG files.',
    useCases: [
      'Convert an iPhone photo before sending it to someone who uses Windows.',
      'Prepare a HEIC image for a website form that accepts JPG files.',
      'Create a JPG copy for an older photo editor or document program.',
      'Change a downloaded HEIC image into a format that is easier to share.',
    ],
    faq: [
      {
        q: 'Why will my HEIC photo not open on Windows?',
        a: 'Some Windows setups and older applications do not include HEIC support. A JPG copy uses a format supported by a wider range of browsers, editors, and viewers.',
      },
      {
        q: 'Will converting HEIC to JPG delete the original?',
        a: 'No. The converter produces a new JPG download and does not replace the HEIC source file on your device.',
      },
      {
        q: 'Does JPG have the same quality as HEIC?',
        a: 'JPG uses different compression, so the result may not be byte-for-byte identical and can lose a small amount of detail. It is intended as a compatible viewing and sharing copy.',
      },
      {
        q: 'Can this convert Live Photos?',
        a: 'This job converts the selected HEIC still image. A Live Photo also contains motion and sound that are not carried into a standard JPG.',
      },
    ],
  },
  'scan-to-searchable-text': {
    intro:
      'Pull words from a scanned page or photo so they can be copied, searched, and edited as text. This is useful when a receipt, letter, form, or printed handout exists only as an image and retyping it would take too long. Clear, straight pages with strong contrast produce the most reliable results; handwriting, shadows, folds, and unusual layouts can cause mistakes. The scan is read in your browser and stays on the device while this job extracts its text. The output is plain text rather than a replacement searchable PDF, so keep the original image for layout and verify names, dates, and other important details before using the result.',
    useCases: [
      'Copy a paragraph from a photographed letter without retyping it.',
      'Extract receipt details so they can be searched in notes or records.',
      'Turn a printed handout into editable text for a document.',
      'Read text from a clear screenshot when the words cannot be selected.',
    ],
    faq: [
      {
        q: 'Does this make the original scan searchable?',
        a: 'It extracts the detected words as plain text. It does not add an invisible text layer to the original image or create a searchable PDF.',
      },
      {
        q: 'How accurate is text extraction from a scan?',
        a: 'Accuracy depends on image clarity, text size, contrast, page angle, and layout. Review the output carefully when exact spelling or numbers matter.',
      },
      {
        q: 'Can it read handwriting or a difficult scan?',
        a: 'The free reader is best with clear printed text. High-Accuracy OCR is the stronger PRO option for hard-to-read scans and handwriting when quality matters more.',
      },
      {
        q: 'How can I get a better result?',
        a: 'Use a sharp image, crop out unrelated surroundings, keep the page straight, and avoid glare or deep shadows across the text.',
      },
    ],
  },
  'remove-photo-location-data': {
    intro:
      'Remove hidden location, camera, and timestamp details from a photo before sending or posting it. Phones and cameras can store extra information inside an image, including GPS coordinates, device details, and the time it was taken. That information is not always visible in the picture, but another person or service may be able to inspect it. This cleanup runs in your browser, with the selected photo kept on the device while its metadata is removed. The job creates a cleaned copy for sharing and leaves the original available. It removes embedded metadata from the processed image, but it cannot remove clues that are visibly shown in the scene itself.',
    useCases: [
      'Remove GPS details before posting a photo taken at home.',
      'Create a cleaned copy of a phone photo before sending it to a stranger.',
      'Strip camera and timestamp information from an image used in a public listing.',
      'Prepare a photo for a forum or social post without its embedded metadata.',
    ],
    faq: [
      {
        q: 'What information can be stored inside a photo?',
        a: 'A photo can contain EXIF metadata such as GPS coordinates, capture time, camera model, lens settings, and software details. The exact fields depend on the device and app that created it.',
      },
      {
        q: 'Will this remove a location visible in the picture?',
        a: 'No. It removes embedded metadata, not visible street signs, faces, house numbers, landmarks, reflections, or other clues in the image itself.',
      },
      {
        q: 'Does the cleanup replace my original photo?',
        a: 'No. It produces a separate cleaned file to download, leaving the source photo unchanged on your device.',
      },
      {
        q: 'Can a website add new metadata after I share the photo?',
        a: 'Possibly. This job cleans the downloaded copy at the time it is created, but another app or service can process that copy or add its own information later.',
      },
    ],
  },
  'share-photo-safely': {
    intro:
      'Create a smaller photo with embedded location and camera details removed before sharing it. One pass first strips private metadata such as GPS and timestamps, then compresses the image so it is easier to send or post. This helps with information hidden inside the file and with oversized attachments, while keeping the visible picture usable for ordinary viewing. Both steps run in your browser, and the photo stays on the device throughout this job. The result is a separate sharing copy, so the original remains available. Visible details in the scene are not concealed, and compression can soften fine detail, so inspect the downloaded image before publishing it.',
    useCases: [
      'Prepare a photo taken at home before sharing it in a public group.',
      'Make a phone photo smaller and remove its GPS details before emailing it.',
      'Create a sharing copy for an online listing without camera metadata.',
      'Clean and reduce an event photo before posting it on a forum.',
    ],
    faq: [
      {
        q: 'What does this job do to the photo?',
        a: 'It removes embedded metadata first, then compresses the image into a smaller sharing copy. The visible content remains, although compression may reduce fine detail.',
      },
      {
        q: 'Does it hide faces, addresses, or license plates?',
        a: 'No. This job does not blur or redact visible content. Review the scene for faces, documents, screens, house numbers, and other details before sharing.',
      },
      {
        q: 'Will I still have the original photo?',
        a: 'Yes. The cleaned and compressed result is downloaded as a separate file, so the original stays available on your device.',
      },
      {
        q: 'Is removing metadata enough for safe sharing?',
        a: 'It reduces information embedded in the file, but safe sharing also depends on the visible image, the audience, and what the receiving service records or adds.',
      },
    ],
  },
  'prepare-image-for-web': {
    intro:
      'Make an oversized image more suitable for a website by resizing it and reducing its file weight. Camera originals are often much larger than a page needs, which can slow loading and waste mobile data without looking sharper at normal display sizes. This job limits the image width and applies compression in one sequence, creating a practical copy for a blog, product page, profile, or portfolio. The image is processed in your browser and stays on the device for this job. The original file is left alone. Because every site has different layout and quality needs, check the result at the size where it will actually appear before publishing it.',
    useCases: [
      'Prepare a large camera photo for a blog post or article.',
      'Reduce a product image before adding it to an online store.',
      'Create a lighter portfolio image for visitors on slower connections.',
      'Resize a team photo before placing it on an About page.',
    ],
    faq: [
      {
        q: 'Why resize an image before putting it on a website?',
        a: 'Serving far more pixels than the page displays increases transfer size and can slow loading. A sensibly sized image is usually faster to deliver and easier to manage.',
      },
      {
        q: 'Will the prepared image look blurry?',
        a: 'It can if the result is displayed larger than its new dimensions or compressed too heavily. Check it in the actual page layout, including on a high-density screen.',
      },
      {
        q: 'Does this replace the source image?',
        a: 'No. It creates a resized, compressed download and leaves the original image available for print, editing, or a different web size.',
      },
      {
        q: 'Is one image size right for every website?',
        a: 'No. The right dimensions depend on the page layout, responsive image setup, and how large the image appears. This job provides a practical general-purpose web copy.',
      },
    ],
  },
  'merge-receipts-into-pdf': {
    intro:
      'Combine separate receipt photos into one PDF that is easier to file, email, or submit for reimbursement. Instead of attaching a loose group of images, this job places the selected receipts into a single document in their chosen order. It works well for travel expenses, purchase records, returns, and monthly bookkeeping when the source receipts were photographed on a phone. The photos are assembled in your browser and stay on the device while this PDF is created. The original images remain unchanged, and the new PDF is downloaded separately. Check that every receipt is upright, readable, and arranged correctly before sending the document to an employer, accountant, or service.',
    useCases: [
      'Bundle travel receipt photos into one document for an expense report.',
      'Combine purchase receipts for a monthly bookkeeping folder.',
      'Create one PDF of receipts needed for a warranty or return claim.',
      'Send an accountant a single organized file instead of several images.',
    ],
    faq: [
      {
        q: 'What order will the receipts appear in?',
        a: 'The PDF follows the order of the selected images. Arrange the receipt photos in the sequence you want before creating the document.',
      },
      {
        q: 'Can I edit receipt amounts in the PDF?',
        a: 'No. This job combines the photos as document pages; it does not change, categorize, or verify the information shown on each receipt.',
      },
      {
        q: 'Will the receipt text be searchable?',
        a: 'The PDF contains the receipt images, so text is not automatically extracted into a searchable text layer. Use text extraction separately when searchable words are needed.',
      },
      {
        q: 'How do I make the finished PDF readable?',
        a: 'Photograph each receipt in good light, keep the camera steady, include all edges, and confirm small totals and dates are legible before merging.',
      },
    ],
  },
  'clean-up-voice-recording': {
    intro:
      'Make speech in a rough voice recording clearer and easier to listen to. Recordings made in a busy room, on a phone, or at an uneven level can distract from the speaker even when the words are still present. This job processes the audio to improve voice clarity and produces a separate cleaned copy for playback or further editing. The recording is handled in your browser and stays on the device while this cleanup runs. Results depend on the source: strong distortion, overlapping speakers, wind, or very faint speech cannot always be repaired. Keep the original recording, compare both versions, and use the one that sounds more natural for the intended audience.',
    useCases: [
      'Improve a phone voice memo before sending it to a colleague.',
      'Clean up spoken notes recorded in a room with background noise.',
      'Prepare an interview clip for easier review or transcription.',
      'Make a lecture or meeting recording more comfortable to replay.',
    ],
    faq: [
      {
        q: 'Can this remove all background noise?',
        a: 'No. It can improve many recordings, but noise that overlaps the same frequencies as speech may remain, and aggressive cleanup can make a voice sound unnatural.',
      },
      {
        q: 'Can it fix clipped or distorted speech?',
        a: 'Severe clipping means part of the original sound was not captured correctly. Cleanup may make the recording easier to hear, but it cannot reliably reconstruct missing audio.',
      },
      {
        q: 'Will it change my original recording?',
        a: 'No. The cleaned audio is produced as a separate result, allowing the source recording to remain available for comparison or another edit.',
      },
      {
        q: 'Should I clean audio before transcribing it?',
        a: 'A clearer recording can help speech recognition when noise masks words. Compare the cleaned version first, because processing that damages speech may reduce transcription accuracy.',
      },
    ],
  },
  'transcribe-a-recording': {
    intro:
      'Turn spoken audio into written text that can be searched, copied, and edited. Use it for a voice memo, interview, meeting, lecture, or other recording when listening through the whole file would be inconvenient. Clear speech, limited background noise, and one speaker at a time generally produce better text; names, accents, technical terms, and overlapping voices may need correction. The recording is transcribed in your browser and stays on the device while this job runs. The output is a draft transcript, not a certified record or a substitute for careful review. Keep the source audio and check important quotations, dates, decisions, and proper names before sharing or relying on the text.',
    useCases: [
      'Turn a voice memo into editable notes for a document.',
      'Create a draft transcript of an interview for review.',
      'Search the spoken content of a recorded meeting or lecture.',
      'Copy key points from an audio recording into a follow-up message.',
    ],
    faq: [
      {
        q: 'How accurate will the transcript be?',
        a: 'Accuracy varies with recording quality, accents, vocabulary, background noise, and speakers talking over one another. Review the transcript against the audio when exact wording matters.',
      },
      {
        q: 'Can it identify different speakers?',
        a: 'Do not assume the draft will label speakers reliably. Add or correct speaker names during review, especially for meetings and interviews.',
      },
      {
        q: 'What if the recording has noise or strong accents?',
        a: 'Transcribe PRO is the stronger hosted option for accents, noisy audio, and long recordings when higher transcription quality is the priority.',
      },
      {
        q: 'Is the transcript ready to publish?',
        a: 'Treat it as a working draft. Check quotations, names, numbers, punctuation, and any passage where the recording is unclear before publishing the text.',
      },
    ],
  },
  'compress-pdf-for-upload': {
    intro:
      'Shrink a PDF that is too large for an application form, document portal, or email attachment. PDFs can grow because they contain high-resolution scans, large images, or content that was not optimized when exported. This job creates a smaller copy so the document has a better chance of fitting the destination limit. Compression runs in your browser, and the PDF stays on the device while this job processes it. The amount saved depends on what is inside the file, so an already optimized PDF may change very little. Review the downloaded copy before submitting it to confirm that small text, signatures, images, and every required page are still clear.',
    useCases: [
      'Reduce a scanned form that a government or school portal rejects as too large.',
      'Make a PDF resume easier to attach to an online application.',
      'Shrink a document before sending it through an email attachment limit.',
      'Create a lighter copy of a report for upload to a client portal.',
    ],
    faq: [
      {
        q: 'Why did my PDF not get much smaller?',
        a: 'A PDF that is mostly text or was already optimized may have little removable data. Image-heavy scans usually offer more room for reduction than compact digital documents.',
      },
      {
        q: 'Will compression make the PDF hard to read?',
        a: 'It can reduce image quality, especially on scanned pages with small print. Open the result and inspect fine text, signatures, diagrams, and photos before uploading it.',
      },
      {
        q: 'Does this change the original PDF?',
        a: 'No. The compressed document is a separate download, so the original remains available if the smaller copy loses too much detail.',
      },
      {
        q: 'What if the result is still above the upload limit?',
        a: 'The destination may require a more aggressive reduction or separate documents. Check its rules before splitting a form, because some portals require every page in one file.',
      },
    ],
  },
  'pdf-to-text': {
    intro:
      'Extract selectable text from a PDF so it can be copied into notes, a document, or another editor. This is useful when copying by hand would be slow or when a long document needs to be searched outside its PDF viewer. The job reads text already stored in the PDF; a page that is only a scanned image may return little or no useful text and may need optical character recognition instead. Extraction runs in your browser, with the PDF kept on the device during this job. The result is plain text, so columns, tables, page layout, images, and some spacing may not survive. Compare important passages with the source document before reuse.',
    useCases: [
      'Copy paragraphs from a digital report into research notes.',
      'Extract contract text for review in a plain-text editor.',
      'Search a long PDF using a separate notes or writing app.',
      'Recover selectable words from a PDF whose viewer makes copying awkward.',
    ],
    faq: [
      {
        q: 'Why did the result contain little or no text?',
        a: 'The PDF may contain page images rather than stored text. A scan needs OCR before its visible words can be converted into editable text.',
      },
      {
        q: 'Will tables and columns keep their layout?',
        a: 'Not necessarily. Plain-text extraction follows the PDF\'s internal reading order, which can mix columns, flatten tables, or add unusual spacing.',
      },
      {
        q: 'Can this summarize the PDF for me?',
        a: 'This job extracts the document text without interpreting it. PDF Summarize is the stronger PRO option when a concise summary matters more than receiving the full raw text.',
      },
      {
        q: 'Does extraction change the PDF?',
        a: 'No. It produces a separate text result and leaves the original document unchanged on your device.',
      },
    ],
  },
  'merge-pdfs': {
    intro:
      'Join separate PDF files into one document in the order needed for sharing, filing, or submission. This is useful when forms, statements, appendices, or scanned pages arrive as several downloads but the recipient expects one attachment. Select the documents in the intended sequence, combine them, and download a single PDF instead of sending a loose set of files. The PDFs are assembled in your browser and stay on the device while this merge job runs. Source files remain unchanged. Merging does not rewrite page content, correct rotation, remove passwords, or make scanned text searchable, so open the finished document and check page order and readability before using it.',
    useCases: [
      'Combine a form and its supporting documents into one submission.',
      'Join monthly statements into a single archive file.',
      'Add a PDF appendix to the end of a report.',
      'Bundle several scanned documents into one email attachment.',
    ],
    faq: [
      {
        q: 'What order will the PDF files use?',
        a: 'The combined document follows the order of the selected files. Arrange them before merging, then verify the first and last pages in the result.',
      },
      {
        q: 'Does merging change the pages?',
        a: 'The job combines existing PDF pages into a new document. It does not edit page text, fix rotation, compress images, or remove unwanted pages.',
      },
      {
        q: 'Can I merge a password-protected PDF?',
        a: 'A protected or encrypted document may not be readable for merging. Use an authorized unlocked copy and preserve any security required by the document owner.',
      },
      {
        q: 'Will the original files be deleted?',
        a: 'No. The merged PDF is a new download, and the separate source documents remain available on your device.',
      },
    ],
  },
  'shrink-video': {
    intro:
      'Make a video file smaller so it is easier to upload, attach, store, or share. Phone recordings and exported clips can be much larger than messaging apps, forms, or slow connections handle comfortably. This job compresses the video into a lighter copy, trading some picture detail for reduced file size while keeping the source recording available. Processing happens in your browser, and the selected video stays on the device during this job. Longer or high-resolution videos take more time and memory to process, especially on a phone or older computer. File-size savings vary by source and compression history, so play the downloaded result and check motion, sound, and readable on-screen text before sending it.',
    useCases: [
      'Reduce a phone video before sending it in a message or email.',
      'Make a short clip fit an upload form with a size limit.',
      'Create a lighter video copy for a slower internet connection.',
      'Shrink a screen recording before sharing it with support or coworkers.',
    ],
    faq: [
      {
        q: 'Will the smaller video lose quality?',
        a: 'Yes, compression can remove picture detail and affect motion. The goal is a useful balance, so watch the result before sharing it when faces, text, or fine details matter.',
      },
      {
        q: 'Why does video compression take a while?',
        a: 'The browser must decode and encode many frames plus the audio track. Longer, larger, and higher-resolution videos require more processing than short clips.',
      },
      {
        q: 'Does this trim or crop the video?',
        a: 'No. This job is for reducing file size, not choosing a shorter section or changing the visible frame. Use a separate editor for trimming or cropping.',
      },
      {
        q: 'What if the video is still too large to upload?',
        a: 'A very strict limit may require a shorter duration, smaller dimensions, or stronger compression. Check the destination rules and keep the original before making another copy.',
      },
    ],
  },
  'spreadsheet-to-json': {
    intro:
      'Turn a CSV spreadsheet into JSON that can be used in an app, script, data import, or configuration file. The first row commonly supplies field names, and each later row becomes a structured record, making the table easier for software to read. This job is intended for CSV data rather than a full Excel workbook with formulas, charts, or multiple sheets. Conversion runs in your browser, and the selected CSV stays on the device while this job creates the JSON result. Check headings, dates, empty cells, leading zeros, and number-like identifiers after conversion, because plain CSV does not preserve every spreadsheet type or formatting choice. The source file remains unchanged.',
    useCases: [
      'Convert a CSV export into records for a small app or website.',
      'Prepare table data for an API test or development fixture.',
      'Turn a contact or inventory CSV into structured JSON for import.',
      'Inspect spreadsheet rows in a format that software tools can parse.',
    ],
    faq: [
      {
        q: 'Can this convert an Excel XLSX file?',
        a: 'This job accepts CSV data, not a full XLSX workbook. Export the relevant sheet as CSV first, then convert that file to JSON.',
      },
      {
        q: 'How are the JSON field names chosen?',
        a: 'Column headings from the CSV are used to identify values in each row. Clear, unique headings produce a result that is easier to understand and use.',
      },
      {
        q: 'Will formulas and spreadsheet formatting be included?',
        a: 'No. CSV contains displayed table values, not formulas, colors, charts, cell comments, or multiple sheets, so those workbook features cannot appear in the JSON.',
      },
      {
        q: 'Why should I check numbers and dates after conversion?',
        a: 'CSV stores plain text with limited type information. Values such as postal codes, account identifiers, dates, and empty cells may need explicit handling in the software that reads the JSON.',
      },
    ],
  },
};
