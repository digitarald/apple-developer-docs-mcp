import * as cheerio from 'cheerio';
import { CacheIntegration, CacheIntegrationResult } from './cache/cache-integration.js';

// Global cache integration instance (will be set by the main server)
let cacheIntegration: CacheIntegration | null = null;

/**
 * Set the global cache integration instance
 */
export function setCacheIntegration(integration: CacheIntegration): void {
  cacheIntegration = integration;
}

/**
 * Cache-aware wrapper for formatJsonDocumentation
 */
export async function formatJsonDocumentationCached(jsonData: any, url: string, options?: { skipCache?: boolean }): Promise<CacheIntegrationResult> {
  if (cacheIntegration) {
    return cacheIntegration.cacheAwareFormat(url, () => formatJsonDocumentation(jsonData, url), options);
  }

  // Fallback to non-cached version
  return {
    content: formatJsonDocumentation(jsonData, url),
    fromCache: false,
    cacheKey: ''
  };
}

/**
 * Cache-aware wrapper for formatHtmlDocumentation
 */
export async function formatHtmlDocumentationCached(html: string, url: string, options?: { skipCache?: boolean }): Promise<CacheIntegrationResult> {
  if (cacheIntegration) {
    return cacheIntegration.cacheAwareFormat(url, () => formatHtmlDocumentation(html, url), options);
  }

  // Fallback to non-cached version
  return {
    content: formatHtmlDocumentation(html, url),
    fromCache: false,
    cacheKey: ''
  };
}

/**
 * Format JSON documentation from Apple Developer Documentation
 */
export function formatJsonDocumentation(jsonData: any, url: string) {
  try {
    // Extract the key information from the JSON structure
    const title = jsonData.title || jsonData.metadata?.title || 'Untitled Documentation';

    // Initialize the content sections
    let markdownContent = `# ${title}\n\n`;
    markdownContent += `**Source:** [${url}](${url})\n\n`;

    // Add abstract/introduction if available
    if (jsonData.abstract && jsonData.abstract.length > 0) {
      const abstractText = processInlineContent(jsonData.abstract);
      markdownContent += `## Overview\n\n${abstractText}\n\n`;
    }

    // Add declaration if available
    if (jsonData.primaryContentSections) {
      const declarationSection = jsonData.primaryContentSections.find(
        (section: any) => section.kind === 'declarations'
      );

      if (declarationSection && declarationSection.declarations) {
        markdownContent += `## Declaration\n\n\`\`\`swift\n`;
        declarationSection.declarations.forEach((declaration: any) => {
          if (declaration.tokens) {
            const declarationText = declaration.tokens
              .map((token: any) => token.text || '')
              .join('');
            markdownContent += `${declarationText}\n`;
          }
        });
        markdownContent += `\`\`\`\n\n`;
      }

      // Add discussion/description if available
      const discussionSection = jsonData.primaryContentSections.find(
        (section: any) => section.kind === 'content'
      );

      if (discussionSection && discussionSection.content) {
        markdownContent += `## Description\n\n`;
        markdownContent += processContentItems(discussionSection.content, jsonData.references);
      }

      // Add parameters if available
      const parametersSection = jsonData.primaryContentSections.find(
        (section: any) => section.kind === 'parameters'
      );

      if (parametersSection && parametersSection.parameters) {
        markdownContent += `## Parameters\n\n`;
        parametersSection.parameters.forEach((param: any) => {
          markdownContent += `### \`${param.name}\`\n\n`;
          if (param.content) {
            markdownContent += processContentItems(param.content, jsonData.references);
          }
        });
      }

      // Add return value if available
      const returnSection = jsonData.primaryContentSections.find(
        (section: any) => section.kind === 'returnValue'
      );

      if (returnSection && returnSection.content) {
        markdownContent += `## Return Value\n\n`;
        markdownContent += processContentItems(returnSection.content, jsonData.references);
      }
    }

    // Add platform availability information
    if (jsonData.metadata && jsonData.metadata.platforms) {
      markdownContent += `## Availability\n\n`;
      jsonData.metadata.platforms.forEach((platform: any) => {
        const betaStatus = platform.beta ? ' (Beta)' : '';
        markdownContent += `- **${platform.name}${betaStatus}**: Introduced in ${platform.introducedAt}\n`;
      });
      markdownContent += `\n`;
    }

    // Add sample code if available
    if (jsonData.sampleCodeDownload) {
      markdownContent += `## Sample Code\n\n`;
      if (jsonData.sampleCodeDownload.action && jsonData.sampleCodeDownload.action.identifier) {
        const sampleId = jsonData.sampleCodeDownload.action.identifier;
        const sampleUrl = `https://docs-assets.developer.apple.com/published/${sampleId}`;
        markdownContent += `Download sample code: [${jsonData.sampleCodeDownload.title || 'Sample Code'}](${sampleUrl})\n\n`;
      }
    }

    // Add topics/subtopics if available
    if (jsonData.topicSections && jsonData.topicSections.length > 0) {
      markdownContent += `## Topics\n\n`;
      jsonData.topicSections.forEach((topic: any) => {
        if (topic.title) {
          markdownContent += `### ${topic.title}\n\n`;
        }

        if (topic.identifiers && topic.identifiers.length > 0) {
          topic.identifiers.forEach((identifier: string) => {
            const reference = jsonData.references && jsonData.references[identifier];
            if (reference) {
              const abstract = reference.abstract ? processInlineContent(reference.abstract) : '';
              markdownContent += `- [${reference.title || identifier}](https://developer.apple.com${reference.url || ''})\n`;
              if (abstract) {
                markdownContent += `  ${abstract}\n`;
              }
            }
          });
          markdownContent += `\n`;
        }
      });
    }

    // Add related items if available
    if (jsonData.relationshipsSections && jsonData.relationshipsSections.length > 0) {
      markdownContent += `## Related\n\n`;
      jsonData.relationshipsSections.forEach((section: any) => {
        if (section.title) {
          markdownContent += `### ${section.title}\n\n`;
        }

        if (section.identifiers && section.identifiers.length > 0) {
          section.identifiers.forEach((identifier: string) => {
            const reference = jsonData.references && jsonData.references[identifier];
            if (reference) {
              markdownContent += `- [${reference.title || identifier}](https://developer.apple.com${reference.url || ''})\n`;
            }
          });
          markdownContent += `\n`;
        }
      });
    }

    // Add see also section if available
    if (jsonData.seeAlsoSections && jsonData.seeAlsoSections.length > 0) {
      markdownContent += `## See Also\n\n`;
      jsonData.seeAlsoSections.forEach((section: any) => {
        if (section.title) {
          markdownContent += `### ${section.title}\n\n`;
        }

        if (section.identifiers && section.identifiers.length > 0) {
          section.identifiers.forEach((identifier: string) => {
            // Handle both internal and external references
            if (identifier.startsWith('http')) {
              // External URL
              markdownContent += `- [${extractTitleFromUrl(identifier)}](${identifier})\n`;
            } else {
              const reference = jsonData.references && jsonData.references[identifier];
              if (reference) {
                const linkUrl = reference.url ? 
                  (reference.url.startsWith('http') ? reference.url : `https://developer.apple.com${reference.url}`) : 
                  '';
                markdownContent += `- [${reference.title || identifier}](${linkUrl})\n`;
              }
            }
          });
          markdownContent += `\n`;
        }
      });
    }

    return {
      content: [
        {
          type: "text" as const,
          text: markdownContent,
        },
      ],
    };
  } catch (error) {
    console.error('Error formatting JSON documentation:', error);
    // Return a simplified version if parsing fails
    return {
      content: [
        {
          type: "text" as const,
          text: `# Documentation: ${url}\n\nUnable to parse the full documentation content. Please visit the original documentation page for complete information.`,
        },
      ],
    };
  }
}

/**
 * Process inline content from Apple Documentation JSON
 */
function processInlineContent(items: any[]): string {
  if (!items || !Array.isArray(items)) return '';
  
  return items.map((item: any) => {
    if (item.text) return item.text;
    if (item.inlineContent) {
      return processInlineContent(item.inlineContent);
    }
    if (item.type === 'reference' && item.identifier) {
      return `\`${item.identifier.split('/').pop()}\``;
    }
    return '';
  }).join('');
}

/**
 * Process content items from Apple Documentation JSON
 */
function processContentItems(items: any[], references: any = {}): string {
  if (!items || !Array.isArray(items)) return '';
  
  let result = '';
  
  items.forEach((item: any) => {
    if (item.type === 'paragraph' && item.inlineContent) {
      result += `${processInlineContent(item.inlineContent)}\n\n`;
    } 
    else if (item.type === 'heading') {
      result += `### ${item.text}\n\n`;
    }
    else if (item.type === 'codeBlock') {
      result += `\`\`\`${item.syntax || ''}\n${item.code || ''}\n\`\`\`\n\n`;
    }
    else if (item.type === 'unorderedList' && item.items) {
      item.items.forEach((listItem: any) => {
        if (listItem.content) {
          result += `- ${processContentItems(listItem.content, references).trim()}\n`;
        }
      });
      result += '\n';
    }
    else if (item.type === 'orderedList' && item.items) {
      item.items.forEach((listItem: any, index: number) => {
        if (listItem.content) {
          result += `${index + 1}. ${processContentItems(listItem.content, references).trim()}\n`;
        }
      });
      result += '\n';
    }
    else if (item.type === 'aside' && item.style && item.content) {
      result += `> **${item.style.toUpperCase()}**: ${processContentItems(item.content, references).trim()}\n\n`;
    }
    else if (item.type === 'codeListing') {
      if (item.syntax) {
        result += `\`\`\`${item.syntax}\n`;
      } else {
        result += '```\n';
      }
      
      if (item.fileLocation) {
        result += `// ${item.fileLocation}\n`;
      }
      
      if (item.code) {
        result += `${item.code}\n`;
      }
      
      result += '```\n\n';
    }
    else if (item.type === 'image' && item.identifier) {
      const image = references && references[item.identifier];
      if (image && image.variants && image.variants.length > 0) {
        const imageUrl = image.variants[0].url;
        const altText = image.alt || 'Image';
        result += `![${altText}](${imageUrl})\n\n`;
      }
    }
  });
  
  return result;
}

/**
 * Extract a title from a URL for display purposes
 */
function extractTitleFromUrl(url: string): string {
  try {
    const pathParts = new URL(url).pathname.split('/');
    let lastPart = pathParts[pathParts.length - 1];
    
    // Remove file extension if present
    if (lastPart.includes('.')) {
      lastPart = lastPart.split('.')[0];
    }
    
    // Format the title: replace hyphens with spaces and capitalize
    return lastPart
      .replace(/-/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
  } catch {
    return url;
  }
}

/**
 * Format HTML documentation from Apple Developer Documentation
 */
export function formatHtmlDocumentation(html: string, url: string) {
  try {
    const $ = cheerio.load(html);

    // Extract the title
    const title = $('h1').first().text().trim() || $('title').text().trim();

    // Initialize the content
    let markdownContent = `# ${title}\n\n`;
    markdownContent += `**Source:** [${url}](${url})\n\n`;

    // Extract main content
    const mainContent = $('.documentation-main').first();
    if (mainContent.length > 0) {
      // Extract the description/overview
      const description = mainContent.find('.description, .abstract, .content-section').first();
      if (description.length > 0) {
        markdownContent += `## Overview\n\n${description.text().trim()}\n\n`;
      }

      // Extract code examples
      const codeBlocks = mainContent.find('pre code');
      if (codeBlocks.length > 0) {
        markdownContent += `## Code Examples\n\n`;
        codeBlocks.each((i, element) => {
          const code = $(element).text().trim();
          const language = $(element).attr('class') || '';
          const lang = language.includes('swift') ? 'swift' :
            language.includes('objective-c') ? 'objective-c' : '';

          markdownContent += `\`\`\`${lang}\n${code}\n\`\`\`\n\n`;
        });
      }

      // Extract topics/subtopics
      const topics = mainContent.find('.topics-section');
      if (topics.length > 0) {
        markdownContent += `## Topics\n\n`;
        topics.each((i, element) => {
          const topicTitle = $(element).find('.topics-section-title').text().trim();
          if (topicTitle) {
            markdownContent += `### ${topicTitle}\n\n`;
          }

          $(element).find('.topic').each((j, topicItem) => {
            const topicLink = $(topicItem).find('a');
            const topicText = topicLink.text().trim();
            const topicUrl = topicLink.attr('href');

            if (topicText && topicUrl) {
              const fullUrl = topicUrl.startsWith('http') ?
                topicUrl : `https://developer.apple.com${topicUrl}`;
              markdownContent += `- [${topicText}](${fullUrl})\n`;
            }
          });

          markdownContent += `\n`;
        });
      }
    } else {
      // Fallback for when the main content container isn't found
      // Remove scripts, styles, and navigation elements
      $('script, style, nav, header, footer').remove();

      // Extract the remaining text content
      let content = $('body').text().trim();
      content = content.replace(/\s+/g, ' ').substring(0, 6000);

      markdownContent += `## Content\n\n${content}\n\n`;
    }

    return {
      content: [
        {
          type: "text" as const,
          text: markdownContent,
        },
      ],
    };
  } catch (error) {
    console.error('Error formatting HTML documentation:', error);
    // Return a simplified version if parsing fails
    return {
      content: [
        {
          type: "text" as const,
          text: `# Documentation: ${url}\n\nUnable to parse the full documentation content. Please visit the original documentation page for complete information.`,
        },
      ],
    };
  }
}
