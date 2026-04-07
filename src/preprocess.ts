import type { SiteRule } from './siteRules'
import { matchSiteRules, applySiteRules } from './siteRules'
import {
  removeNonContentElements,
  removeHiddenElements,
  removeErrorImages,
  removeSmallImages,
  removeDecorativeSvgs,
  removeMeaninglessFigures,
  removeSvgPlaceholderImages,
  removeFigurelessFigcaptions,
  removeFigureNoise,
  removeKnownNonContent,
  removeRubricLabels,
  removeInlineRecommendedWidgets,
  removeNonArticleSections,
  removeMetadataLists,
  removeShareLinkBylines,
  removeShareWidgets,
  removeStandalonePublicationDates,
  removeLooseNonArticleHeadings,
  removeComplementaryElements,
  removeStubElements,
  removeAudioPlayerWidgets,
  removeBreadcrumbs,
} from './remove'
import {
  replacePicturesWithImgs,
  addSrcToSrcsetOnlyImages,
  neutralizeArticleHeaders,
  unwrapFigureImageButtons,
  stripNextJsFillImages,
  trimEdgeBrs,
  mergeDatelines,
  flattedSingleChildDivs,
  promoteImageBlocks,
  extractFigureCaptionBlocks,
  adoptOrphanedFigcaptions,
  unwrapCustomElements,
  unwrapFigureWrappers,
  stripAriaHiddenFromCaptions,
  stripAriaHidden,
  unwrapDropcaps,
  unwrapMarkElements,
  unwrapFontElements,
  unwrapHgroups,
  unwrapNestedLists,
  stripHtmlComments,
  stripBooklikeStamps,
  injectLedeImage,
} from './normalize'
import { stampContentWrappers } from './helpers'

export interface PreprocessResult {
  ledeHTML: string | null
  upgradeMap: Map<string, string[]>
}

function removeNonContent(doc: Document, siteRule?: SiteRule): void {
  applySiteRules(doc, siteRule)
  removeNonContentElements(doc)
  removeKnownNonContent(doc)
  removeRubricLabels(doc)
  removeInlineRecommendedWidgets(doc)
  removeNonArticleSections(doc)
  removeMetadataLists(doc)
  removeShareLinkBylines(doc)
  removeShareWidgets(doc)
  removeStandalonePublicationDates(doc)
  removeLooseNonArticleHeadings(doc)
  removeComplementaryElements(doc)
  removeFigureNoise(doc)
  removeStubElements(doc)
  removeAudioPlayerWidgets(doc)
  removeBreadcrumbs(doc)
}

export function identifyContentImageSrcs(doc: Document): Set<string> {
  removeNonContent(doc, matchSiteRules(doc))
  const srcs = new Set<string>()
  doc.querySelectorAll<HTMLImageElement>('img').forEach((img) => {
    const src = img.getAttribute('src') ?? img.getAttribute('data-src') ?? ''
    if (src) srcs.add(src)
  })
  return srcs
}

export function preprocess(doc: Document): PreprocessResult {
  stampContentWrappers(doc.body)
  const siteRule = matchSiteRules(doc)
  removeNonContent(doc, siteRule)
  stripAriaHidden(doc)
  removeHiddenElements(doc)
  removeErrorImages(doc)
  removeMeaninglessFigures(doc)
  removeSmallImages(doc)
  removeDecorativeSvgs(doc)
  neutralizeArticleHeaders(doc)
  unwrapFigureImageButtons(doc)
  trimEdgeBrs(doc)
  mergeDatelines(doc)
  flattedSingleChildDivs(doc)
  addSrcToSrcsetOnlyImages(doc)
  const upgradeMap = replacePicturesWithImgs(doc)
  removeSvgPlaceholderImages(doc)
  const ledeHTML = injectLedeImage(doc, siteRule)
  adoptOrphanedFigcaptions(doc)
  removeFigurelessFigcaptions(doc)
  promoteImageBlocks(doc)
  extractFigureCaptionBlocks(doc)
  removeMeaninglessFigures(doc)
  unwrapCustomElements(doc)
  unwrapFigureWrappers(doc)
  stripAriaHiddenFromCaptions(doc)
  unwrapDropcaps(doc)
  unwrapMarkElements(doc)
  unwrapFontElements(doc)
  unwrapHgroups(doc)
  unwrapNestedLists(doc)
  stripNextJsFillImages(doc)
  stripHtmlComments(doc)
  stripBooklikeStamps(doc)
  return { ledeHTML, upgradeMap }
}
