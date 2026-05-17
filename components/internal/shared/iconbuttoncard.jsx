import React from "react";
import { cn } from "@/lib/utils";

export function IconButtonCard({
  banner,
  subBanner,
  icon,
  title,
  subtitle,
  endingComponent,
  classNames = {},
  className,
}) {
  return (
    <div className={cn("flex flex-col gap-4", className, classNames.wrapper)}>
      {(banner || subBanner) && (
        <div className={cn("flex flex-col gap-1.5", classNames.bannerWrapper)}>
          {banner && (
            <h3
              className={cn(
                "text-xl font-medium text-foreground",
                classNames.banner,
              )}
            >
              {banner}
            </h3>
          )}
          {subBanner && (
            <p
              className={cn(
                "text-sm text-muted-foreground",
                classNames.subBanner,
              )}
            >
              {subBanner}
            </p>
          )}
        </div>
      )}

      <div
        className={cn(
          "flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 py-4 border rounded-xl bg-card text-card-foreground shadow-sm",
          classNames.container,
        )}
      >
        <div
          className={cn("flex items-center gap-4", classNames.contentWrapper)}
        >
          {icon && (
            <div
              className={cn(
                "flex items-center justify-center w-10 h-10 rounded-md bg-secondary border text-secondary-foreground shrink-0",
                classNames.iconWrapper,
              )}
            >
              {icon}
            </div>
          )}

          <div className={cn("flex flex-col gap-0.5", classNames.textWrapper)}>
            <h4
              className={cn(
                "font-medium text-foreground text-base",
                classNames.title,
              )}
            >
              {title}
            </h4>
            {subtitle && (
              <p
                className={cn(
                  "text-sm text-muted-foreground",
                  classNames.subtitle,
                )}
              >
                {subtitle}
              </p>
            )}
          </div>
        </div>

        {endingComponent && (
          <div
            className={cn("flex-shrink-0 md:ml-4", classNames.endingComponent)}
          >
            {endingComponent}
          </div>
        )}
      </div>
    </div>
  );
}

export default IconButtonCard;
