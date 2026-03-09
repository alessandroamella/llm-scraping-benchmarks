export type PreProcessingStrategy =
  | 'raw-html' // No cleaning at all
  | 'basic-cleanup' // Regex removal of <script>/<style>
  | 'html-to-markdown' // Converting to markdown for token savings
  | 'dom-distillation' // Keeping only specific article/content tags
  | 'dom-distillation-markdown' // Distilled content converted to markdown
  | 'flat-json' // Convert DOM to a flat JSON structure with tag and text info
  | 'mineru-html' // A Small Language Model that converts the full HTML to a stripped-down version
  | 'jina-reader'; // A Vision Language Model that converts the HTML to Markdown intelligently, keeping important info and discarding noise
