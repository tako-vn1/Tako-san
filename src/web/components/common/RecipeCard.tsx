import React from 'react';
import { RecipeMatchResult } from '@frigo/recipes';
import { Clock, CheckCircle, Flame, Users } from 'lucide-react';
import { resolveRecipeImage, recipeImageErrorHandler } from '../../lib/recipe-media';

interface RecipeCardProps {
  matchResult: RecipeMatchResult;
  onClick: () => void;
  compact?: boolean;
  headingLevel?: 2 | 3;
  variant?: 'row' | 'feature' | 'grid';
}

export const RecipeCard: React.FC<RecipeCardProps> = ({
  matchResult,
  onClick,
  compact = false,
  headingLevel = 2,
  variant = 'row',
}) => {
  const { recipe, matchPercentage, canCookWithoutBuying, missingRequiredIngredients } = matchResult;
  const image = resolveRecipeImage(recipe);
  const Heading = headingLevel === 3 ? 'h3' : 'h2';
  const href = `/recipes/${recipe.slug}`;

  const handleClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }

    event.preventDefault();
    onClick();
  };

  const cuisineFlags: Record<string, string> = {
    vietnamese: '🇻🇳',
    korean: '🇰🇷',
    japanese: '🇯🇵',
    chinese: '🇨🇳',
    thai: '🇹🇭',
    italian: '🇮🇹',
  };

  if (compact) {
    return (
      <a
        href={href}
        aria-label={recipe.title}
        onClick={handleClick}
        className="bg-white rounded-2xl overflow-hidden border border-semantic-border shadow-card hover:border-takosan-green/50 hover:shadow-elevated active:scale-[0.97] transition-tap cursor-pointer flex flex-col w-48 shrink-0 focus-visible:outline-none focus-visible:shadow-t17-focus"
      >
        <div className="relative w-full h-32 overflow-hidden bg-semantic-border/60">
          <img
            src={image.src}
            alt={recipe.title}
            className="w-full h-full object-cover"
            loading="lazy"
            onError={recipeImageErrorHandler(image.fallbackSrc)}
          />
          {/* Match badge — gradient, nổi bật hơn */}
          <span
            className={`absolute top-2 left-2 px-2.5 py-1 rounded-full text-[11px] font-heading font-bold text-white shadow-sm ${
              matchPercentage >= 80
                ? 'bg-takosan-green'
                : 'bg-semantic-overlay/80 backdrop-blur-sm'
            }`}
          >
            {cuisineFlags[recipe.cuisine] || '🌍'} {matchPercentage}%
          </span>
          {canCookWithoutBuying && (
            <span className="absolute top-2 right-2 w-6 h-6 rounded-full bg-takosan-green shadow-sm flex items-center justify-center">
              <CheckCircle className="w-4 h-4 text-white" />
            </span>
          )}
        </div>

        <div className="p-3 flex-1 flex flex-col justify-between gap-2">
          <Heading className="font-heading font-bold text-[13px] text-semantic-text-primary line-clamp-2 leading-snug min-h-[2.2em]">
            {recipe.title}
          </Heading>
          <div className="flex items-center justify-between text-[11px] text-semantic-text-secondary">
            <span className="flex items-center gap-1 font-semibold">
              <Clock className="w-3.5 h-3.5 text-takosan-green" />
              {recipe.cookTimeMinutes}p
            </span>
            {canCookWithoutBuying ? (
              <span className="text-takosan-green font-heading font-bold">Đủ 100%</span>
            ) : (
              <span className="text-semantic-warning-strong font-bold">Thiếu {missingRequiredIngredients.length}</span>
            )}
          </div>
        </div>
      </a>
    );
  }

  if (variant === 'feature') {
    return (
      <a
        href={href}
        aria-label={recipe.title}
        onClick={handleClick}
        className="bg-white rounded-2xl overflow-hidden border border-semantic-border shadow-card hover:border-takosan-green/50 hover:shadow-elevated active:scale-[0.99] transition-tap cursor-pointer grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] min-h-[190px] focus-visible:outline-none focus-visible:shadow-t17-focus"
      >
        <div className="relative min-h-[190px] overflow-hidden bg-semantic-border/60">
          <img
            src={image.src}
            alt={recipe.title}
            className="w-full h-full object-cover"
            loading="lazy"
            onError={recipeImageErrorHandler(image.fallbackSrc)}
          />
          <span className="absolute bottom-2 left-2 px-2 py-1 rounded-lg bg-black/65 backdrop-blur text-[11px] font-bold text-white">
            {cuisineFlags[recipe.cuisine] || '🌍'}
          </span>
          {canCookWithoutBuying && (
            <span className="absolute top-2 right-2 w-7 h-7 rounded-full bg-takosan-green shadow-sm flex items-center justify-center">
              <CheckCircle className="w-4 h-4 text-white" />
            </span>
          )}
        </div>

        <div className="p-4 flex flex-col justify-center gap-2 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            {canCookWithoutBuying ? (
              <span className="text-[11px] font-bold px-2 py-1 rounded-full bg-takosan-mint text-takosan-green-deep border border-takosan-mint-deep/80">
                Đủ 100%
              </span>
            ) : (
              <span className="text-[11px] font-bold px-2 py-1 rounded-full bg-semantic-warning-soft text-semantic-warning-strong border border-semantic-warning/30">
                Thiếu {missingRequiredIngredients.length} món
              </span>
            )}
            <span className="inline-flex items-center gap-1 text-[11px] font-heading font-extrabold text-takosan-green">
              <Flame className="w-3.5 h-3.5 text-semantic-accent" />
              {matchPercentage}%
            </span>
          </div>

          <Heading className="font-heading font-bold text-lg text-semantic-text-primary leading-snug line-clamp-3">
            {recipe.title}
          </Heading>
          <p className="text-xs text-semantic-text-muted line-clamp-2 leading-relaxed">
            {recipe.description}
          </p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-2 border-t border-semantic-border/70 text-xs">
            <span className="flex items-center gap-1 text-semantic-text-secondary font-semibold">
              <Clock className="w-4 h-4 text-takosan-green" />
              {recipe.cookTimeMinutes} phút
            </span>
            <span className="flex items-center gap-1 text-semantic-text-muted">
              <Users className="w-3.5 h-3.5" />
              {recipe.servings} người
            </span>
          </div>
        </div>
      </a>
    );
  }

  if (variant === 'grid') {
    return (
      <a
        href={href}
        aria-label={recipe.title}
        onClick={handleClick}
        className="bg-white rounded-2xl overflow-hidden border border-semantic-border shadow-card hover:border-takosan-green/50 hover:shadow-elevated active:scale-[0.98] transition-tap cursor-pointer flex flex-col h-full focus-visible:outline-none focus-visible:shadow-t17-focus"
      >
        <div className="relative aspect-[4/3] overflow-hidden bg-semantic-border/60">
          <img
            src={image.src}
            alt={recipe.title}
            className="w-full h-full object-cover"
            loading="lazy"
            onError={recipeImageErrorHandler(image.fallbackSrc)}
          />
          <span className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-black/65 backdrop-blur text-[10px] font-bold text-white">
            {cuisineFlags[recipe.cuisine] || ''}
          </span>
          {canCookWithoutBuying && (
            <span className="absolute top-2 left-2 w-7 h-7 rounded-full bg-takosan-green shadow-sm flex items-center justify-center">
              <CheckCircle className="w-4 h-4 text-white" />
            </span>
          )}
        </div>

        <div className="p-3.5 flex-1 flex flex-col gap-2">
          <div className="flex items-center gap-1.5 flex-wrap">
            {canCookWithoutBuying ? (
              <span className="text-[11px] font-bold px-2 py-1 rounded-full bg-takosan-mint text-takosan-green-deep border border-takosan-mint-deep/80">
                Đủ 100%
              </span>
            ) : (
              <span className="text-[11px] font-bold px-2 py-1 rounded-full bg-semantic-warning-soft text-semantic-warning-strong border border-semantic-warning/30">
                Thiếu {missingRequiredIngredients.length} món
              </span>
            )}
            <span className="inline-flex items-center gap-1 text-[11px] font-heading font-extrabold text-takosan-green">
              <Flame className="w-3.5 h-3.5 text-semantic-accent" />
              {matchPercentage}%
            </span>
          </div>
          <Heading className="font-heading font-bold text-[15px] text-semantic-text-primary leading-snug line-clamp-2">
            {recipe.title}
          </Heading>
          <p className="text-xs text-semantic-text-muted line-clamp-2 leading-relaxed">
            {recipe.description}
          </p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-auto pt-2 border-t border-semantic-border/70 text-xs">
            <span className="flex items-center gap-1 text-semantic-text-secondary font-semibold">
              <Clock className="w-4 h-4 text-takosan-green" />
              {recipe.cookTimeMinutes} phút
            </span>
            <span className="flex items-center gap-1 text-semantic-text-muted">
              <Users className="w-3.5 h-3.5" />
              {recipe.servings} người
            </span>
          </div>
        </div>
      </a>
    );
  }

  return (
    <a
      href={href}
      aria-label={recipe.title}
      onClick={handleClick}
      className="bg-white rounded-2xl p-3.5 flex gap-4 items-center border border-semantic-border shadow-card hover:border-takosan-green/50 hover:shadow-elevated active:scale-[0.99] transition-tap cursor-pointer focus-visible:outline-none focus-visible:shadow-t17-focus"
    >
      <div className="relative w-[104px] h-[104px] rounded-xl overflow-hidden shrink-0 bg-semantic-border/60 shadow-xs">
        <img
          src={image.src}
          alt={recipe.title}
          className="w-full h-full object-cover"
          loading="lazy"
          onError={recipeImageErrorHandler(image.fallbackSrc)}
        />
        <span className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/65 backdrop-blur text-[10px] font-bold text-white">
          {cuisineFlags[recipe.cuisine] || ''}
        </span>
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
          {canCookWithoutBuying ? (
            <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-takosan-mint text-takosan-green-deep border border-takosan-mint-deep/80 flex items-center gap-1">
              <CheckCircle className="w-3.5 h-3.5 text-takosan-green" /> Đủ 100%
            </span>
          ) : (
            <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-semantic-warning-soft text-semantic-warning-strong border border-semantic-warning/30">
              Thiếu {missingRequiredIngredients.length} món
            </span>
          )}
          <span className="inline-flex items-center gap-1 text-[11px] font-heading font-extrabold text-takosan-green">
            <Flame className="w-3.5 h-3.5 text-semantic-accent" />
            Khớp {matchPercentage}%
          </span>
        </div>

        <Heading className="font-heading font-bold text-[15px] text-semantic-text-primary leading-snug truncate">
          {recipe.title}
        </Heading>

        <p className="text-xs text-semantic-text-muted line-clamp-1 mt-0.5 leading-relaxed">
          {recipe.description}
        </p>

        <div className="flex flex-wrap items-center justify-between gap-x-1.5 mt-2.5 pt-2 border-t border-semantic-border/70 text-xs">
          <span className="flex items-center gap-1 text-semantic-text-secondary font-semibold">
            <Clock className="w-4 h-4 text-takosan-green" />
            <span>{recipe.cookTimeMinutes} phút</span>
          </span>
          {recipe.nutrition && (
            <span className="text-[10px] font-bold text-semantic-warning-strong bg-semantic-warning-soft px-2 py-0.5 rounded-md border border-semantic-warning/30">
              {recipe.nutrition.calories} kcal
            </span>
          )}
          <span className="flex items-center gap-1 text-[11px] font-medium text-semantic-text-muted">
            <Users className="w-3.5 h-3.5" />
            {recipe.servings} người
          </span>
        </div>
      </div>
    </a>
  );
};
