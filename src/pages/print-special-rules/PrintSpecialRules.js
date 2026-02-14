import { useState, useEffect, useMemo } from "react";
import { useParams } from "react-router-dom";
import { useSelector } from "react-redux";
import { FormattedMessage, useIntl } from "react-intl";
import { Helmet } from "react-helmet-async";

import { Header } from "../../components/page";
import { Button } from "../../components/button";
import { useLanguage } from "../../utils/useLanguage";
import { rulesMap } from "../../components/rules-index/rules-map";
import { normalizeRuleName } from "../../utils/string";

import "./PrintSpecialRules.css";

// Normalize parameterized special rules (e.g., "Impact Hits (1)" -> "Impact Hits (X)")
const normalizeSpecialRule = (rule) => {
  // Match pattern: "Rule Name (content)"
  const match = rule.match(/^(.+?)\s*\(([^)]+)\)$/);
  if (match) {
    const ruleName = match[1];
    const parameter = match[2].trim();

    // Check if parameter starts with a number or dice notation
    // This catches: "1", "D3+1", "3 - Impact Hits", "2D6", etc.
    // But NOT: "Orc Boar Boys & Boss only", "per model", etc.
    if (/^[\dD]/.test(parameter)) {
      return `${ruleName} (X)`;
    }

    // Also check if it's already normalized as "X"
    if (parameter === 'X') {
      return rule;
    }
  }
  return rule;
};

// Extract all special rules from the army list
const extractSpecialRules = (list, language) => {
    if (!list) return [];

    const rulesSet = new Set();
    const armyComposition = list.armyComposition || list.army;

    // All unit categories
    const allUnits = [
      ...(list.characters || []),
      ...(list.lords || []),
      ...(list.heroes || []),
      ...(list.core || []),
      ...(list.special || []),
      ...(list.rare || []),
      ...(list.mercenaries || []),
      ...(list.allies || []),
    ];

    allUnits.forEach((unit) => {
      // Main unit special rules
      const specialRules =
        unit.armyComposition?.[armyComposition]?.specialRules ||
        unit.specialRules;
      if (specialRules) {
        const rulesText =
          specialRules[`name_${language}`] || specialRules.name_en;
        if (rulesText) {
          // Remove page references like {p.123}
          const cleaned = rulesText.replace(/ *\{[^)]*\}/g, "");
          // Split by comma-space and add to set
          cleaned.split(", ").forEach((rule) => {
            const trimmed = rule.trim();
            if (trimmed) {
              // Normalize parameterized rules before adding to set
              rulesSet.add(normalizeSpecialRule(trimmed));
            }
          });
        }
      }

      // Detachment special rules
      if (unit.detachments) {
        unit.detachments.forEach((detachment) => {
          const detachmentRules =
            detachment.armyComposition?.[armyComposition]?.specialRules ||
            detachment.specialRules;
          if (detachmentRules?.name_en) {
            const rulesText =
              detachmentRules[`name_${language}`] ||
              detachmentRules.name_en;
            const cleaned = rulesText.replace(/ *\{[^)]*\}/g, "");
            cleaned.split(", ").forEach((rule) => {
              const trimmed = rule.trim();
              if (trimmed) {
                // Normalize parameterized rules before adding to set
                rulesSet.add(normalizeSpecialRule(trimmed));
              }
            });
          }
        });
      }
    });

    // Convert to sorted array
    return Array.from(rulesSet).sort((a, b) => a.localeCompare(b));
};

export const PrintSpecialRules = () => {
  const { listId } = useParams();
  const { language } = useLanguage();
  const intl = useIntl();
  const [isPrinting, setIsPrinting] = useState(false);
  const [ruleContents, setRuleContents] = useState({});
  const [isLoadingRules, setIsLoadingRules] = useState(false);
  const list = useSelector((state) =>
    state.lists.find(({ id }) => listId === id)
  );

  // Memoize specialRules to prevent infinite re-renders
  const specialRules = useMemo(() => {
    return extractSpecialRules(list, language);
  }, [list, language]);

  // Fetch all rules when component mounts or special rules change
  useEffect(() => {
    const fetchRuleContent = async (ruleName) => {
      try {
        // Normalize rule name to match rulesMap
        const normalizedName = normalizeRuleName(ruleName);
        const ruleData = rulesMap[normalizedName];

        if (!ruleData?.url) {
          return null;
        }

        // Fetch HTML from whfb.app
        const response = await fetch(
          `https://tow.whfb.app/${ruleData.url}?minimal=true&utm_source=owb&utm_medium=referral`
        );

        if (!response.ok) {
          return null;
        }

        const html = await response.text();

        // Parse HTML and extract article content
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // Get all article elements that are NOT the intro section
        // The intro has class "section-intro", we want the actual rule mechanics
        const articles = doc.querySelectorAll('article.article--rich-text:not(.section-intro)');

        if (articles.length > 0) {
          // Process each article to clean up unwanted elements
          const cleanedContent = Array.from(articles).map(article => {
            // Clone the article to avoid modifying the original DOM
            const clone = article.cloneNode(true);

            // Remove all SVG elements
            const svgs = clone.querySelectorAll('svg');
            svgs.forEach(svg => svg.remove());

            // Replace all anchor tags with their text content
            const links = clone.querySelectorAll('a');
            links.forEach(link => {
              const textNode = document.createTextNode(link.textContent);
              link.parentNode.replaceChild(textNode, link);
            });

            return clone.innerHTML;
          }).join('');

          return cleanedContent;
        }

        return null;
      } catch (error) {
        console.error(`Error fetching rule ${ruleName}:`, error);
        return null;
      }
    };

    const fetchAllRules = async () => {
      if (specialRules.length === 0) return;

      setIsLoadingRules(true);

      // Fetch all rules in parallel
      const fetchPromises = specialRules.map(async (ruleName) => {
        const content = await fetchRuleContent(ruleName);
        return { ruleName, content };
      });

      const results = await Promise.all(fetchPromises);

      // Convert array to object for easy lookup
      const contentsMap = {};
      results.forEach(({ ruleName, content }) => {
        if (content) {
          contentsMap[ruleName] = content;
        }
      });

      setRuleContents(contentsMap);
      setIsLoadingRules(false);
    };

    fetchAllRules();
  }, [specialRules]);

  // Early return after all hooks have been called
  if (!list) {
    return (
      <Header
        headline={intl.formatMessage({
          id: "print.specialRulesTitle",
        })}
      />
    );
  }

  const handlePrintClick = () => {
    setIsPrinting(true);
    document.title = `${list.name} - Special Rules - Old World Builder`;
    window.onafterprint = () => {
      document.title = "Old World Builder";
      setIsPrinting(false);
    };
    window.print();
  };

  return (
    <>
      <Helmet>
        <title>{`Old World Builder | ${list?.name} - Special Rules`}</title>
      </Helmet>
      <div className="hide-for-printing">
        <Header
          to={`/editor/${listId}`}
          headline={intl.formatMessage({
            id: "print.specialRulesTitle",
          })}
        />
        <div className="print-special-rules__button">
          <Button
            centered
            icon="print"
            color="blue"
            onClick={handlePrintClick}
          >
            {isPrinting ? (
              <FormattedMessage id="print.printing" />
            ) : (
              <FormattedMessage id="misc.print" />
            )}
          </Button>
        </div>
        <h3>
          <FormattedMessage id="print.preview" />
        </h3>
      </div>
      <div className="print-special-rules">
        <h1>
          <FormattedMessage id="print.specialRulesHeadline" />
        </h1>
        {specialRules.length === 0 ? (
          <p>
            <FormattedMessage id="print.noSpecialRules" />
          </p>
        ) : (
          <div>
            {isLoadingRules && (
              <p className="print-special-rules__loading">
                <FormattedMessage id="print.loadingRules" />
              </p>
            )}
            {specialRules.map((rule, index) => (
              <div key={index} className="print-special-rules__rule">
                <h3 className="print-special-rules__rule-title">{rule}</h3>
                {ruleContents[rule] ? (
                  <div
                    className="print-special-rules__rule-content"
                    dangerouslySetInnerHTML={{ __html: ruleContents[rule] }}
                  />
                ) : (
                  <p className="print-special-rules__rule-not-found">
                    <em>Rule description not available</em>
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
        <div className="print-special-rules-footer">
          <p>
            <FormattedMessage id="export.createdWith" />{" "}
            <a href="https://old-world-builder.com">Old World Builder</a>
          </p>
        </div>
      </div>
    </>
  );
};
