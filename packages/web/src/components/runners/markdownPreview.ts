import DOMPurify from 'dompurify';

export function prepareMarkdownPreview(output: string): { blob: Blob; text: string } {
  const clean = DOMPurify.sanitize(output);
  const template = document.createElement('template');
  template.innerHTML = clean;
  for (const node of template.content.querySelectorAll(
    'img,video,audio,source,track,svg,math,style,link,iframe,object,embed,form,button,textarea,select,option',
  ))
    node.remove();
  for (const node of template.content.querySelectorAll('input')) {
    if (node.type !== 'checkbox' || !node.disabled || !node.closest('li')) node.remove();
    else
      for (const attribute of ['name', 'form', 'formaction', 'value'])
        node.removeAttribute(attribute);
  }
  for (const node of template.content.querySelectorAll('*')) {
    for (const name of [
      'src',
      'srcset',
      'poster',
      'background',
      'style',
      'xlink:href',
      'action',
      'formaction',
    ])
      node.removeAttribute(name);
    if (node.tagName !== 'A') node.removeAttribute('href');
  }
  const text = template.innerHTML;
  const blob = new Blob(['<!doctype html><meta charset="utf-8">', text], { type: 'text/html' });
  if (
    new TextEncoder().encode(text).byteLength > 50 * 1024 * 1024 ||
    blob.size > 50 * 1024 * 1024
  ) {
    throw new Error('Markdown preview exceeds 50 MiB.');
  }
  return { blob, text };
}
