"use client";

import React, { useState, useEffect } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel, 
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useTheme } from "next-themes";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  CircleUserRound,
  Settings,
  Wallet,
  LogOut,
  Moon,
  Sun,
  UsersRound,
  LifeBuoy,
  MessageCircle,
  ShieldCheck,
  BookMarked,
  ExternalLink,
} from "lucide-react";
import { getUser } from "@/lib/supabase/user";

const surfaceStyle = {
  backgroundColor: "#1a1a1a",
  borderColor: "#2a2a2a",
  color: "#ffffff",
};

const itemBaseStyle =
  "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm cursor-default transition-colors outline-none";

const itemHoverStyle = "hover:bg-[#242424] focus:bg-[#242424] text-[#a3a3a3] hover:text-white focus:text-white";

export function ProfileDropdown({ children }) {
  const [user, setUser] = useState(null);
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    getUser().then((u) => {
      if (u) setUser(u);
    });
  }, []);

  const pfpUrl = user?.id
    ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/pfp/${user.id}/latest.jpg`
    : null;

  const displayName = user?.name || "User";
  const displayEmail = user?.email || "user@email.com";
  const initials = displayName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {children || (
          <button className="w-8 h-8 rounded-full border border-[#333333] hover:border-[#474747] overflow-hidden ml-1 transition-colors">
            <Avatar className="size-full">
              {pfpUrl && (
                <AvatarImage src={pfpUrl} alt={displayName} />
              )}
              <AvatarFallback className="bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 text-white text-[10px] font-semibold border-0">
                {initials}
              </AvatarFallback>
            </Avatar>
          </button>
        )}
      </DropdownMenuTrigger>

      <DropdownMenuContent
        className="w-72 p-0 rounded-xl border shadow-xl"
        style={surfaceStyle}
        sideOffset={8}
        align="end"
      >
        <div className="p-4 pb-3">
          <DropdownMenuLabel className="p-0">
            <div className="flex items-center gap-3">
              <Avatar className="size-10 border border-[#333333]">
                {pfpUrl && (
                  <AvatarImage src={pfpUrl} alt={displayName} />
                )}
                <AvatarFallback className="bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 text-white text-xs font-semibold border-0">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="flex flex-col min-w-0 flex-1">
                <span className="text-sm font-semibold text-white truncate">
                  {displayName}
                </span>
                <span className="text-xs text-[#a3a3a3] truncate">
                  {displayEmail}
                </span>
              </div>
            </div>
          </DropdownMenuLabel>
        </div>

        <DropdownMenuSeparator className="bg-[#2a2a2a] mx-0" />

        <div className="p-1.5">
          <DropdownMenuGroup>
            <DropdownMenuItem
              className={`${itemBaseStyle} ${itemHoverStyle}`}
            >
              <CircleUserRound className="size-4 text-[#a3a3a3]" />
              <span>Profile</span>
            </DropdownMenuItem>

            <DropdownMenuItem
              className={`${itemBaseStyle} ${itemHoverStyle}`}
            >
              <UsersRound className="size-4 text-[#a3a3a3]" />
              <span>Organization Settings</span>
            </DropdownMenuItem>

            <DropdownMenuItem
              className={`${itemBaseStyle} ${itemHoverStyle}`}
            >
              <Wallet className="size-4 text-[#a3a3a3]" />
              <span>Billing & Plans</span>
            </DropdownMenuItem>
          </DropdownMenuGroup>

          <DropdownMenuSeparator className="bg-[#2a2a2a] my-1" />

          <DropdownMenuGroup>
            <DropdownMenuItem className="hover:bg-transparent focus:bg-transparent p-2 cursor-default">
              <ToggleGroup
                type="single"
                value={theme}
                onValueChange={(value) => { if (value) setTheme(value); }}
                className="bg-[#111111] flex items-center justify-evenly rounded-lg p-0.5 w-full"
              >
                <ToggleGroupItem
                  value="light"
                  className="data-[state=on]:bg-[#242424] data-[state=on]:text-white text-[#a3a3a3] rounded-md hover:bg-[#1f1f1f] hover:text-white px-3 h-7 text-xs gap-1.5 flex-1 justify-center"
                >
                  <Sun className="size-3.5" />
                </ToggleGroupItem>
                <ToggleGroupItem
                  value="dark"
                  className="data-[state=on]:bg-[#242424] data-[state=on]:text-white text-[#a3a3a3] rounded-md hover:bg-[#1f1f1f] hover:text-white px-3 h-7 text-xs gap-1.5 flex-1 justify-center"
                >
                  <Moon className="size-3.5" />
                </ToggleGroupItem>
              </ToggleGroup>
            </DropdownMenuItem>

            <DropdownMenuItem
              className={`${itemBaseStyle} ${itemHoverStyle}`}
            >
              <Settings className="size-4 text-[#a3a3a3]" />
              <span>Settings</span>
            </DropdownMenuItem>

            <DropdownMenuItem
              className={`${itemBaseStyle} ${itemHoverStyle}`}
            >
              <ShieldCheck className="size-4 text-[#a3a3a3]" />
              <span>Security</span>
            </DropdownMenuItem>
          </DropdownMenuGroup>

          <DropdownMenuSeparator className="bg-[#2a2a2a] my-1" />

          <DropdownMenuGroup>
            <DropdownMenuItem
              className={`${itemBaseStyle} ${itemHoverStyle}`}
            >
              <BookMarked className="size-4 text-[#a3a3a3]" />
              <span>Documentation</span>
              <ExternalLink className="size-3 ml-auto text-[#737373]" />
            </DropdownMenuItem>

            <DropdownMenuItem
              className={`${itemBaseStyle} ${itemHoverStyle}`}
            >
              <MessageCircle className="size-4 text-[#a3a3a3]" />
              <span>Send Feedback</span>
            </DropdownMenuItem>

            <DropdownMenuItem
              className={`${itemBaseStyle} ${itemHoverStyle}`}
            >
              <LifeBuoy className="size-4 text-[#a3a3a3]" />
              <span>Help & Support</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              className={`${itemBaseStyle} hover:bg-[#2a1a1a] focus:bg-[#2a1a1a] text-[#a3a3a3] hover:text-red-400 focus:text-red-400 group`}
            >
              <LogOut className="size-4 group-hover:text-red-400" />
              <span>Sign out</span>
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </div>

        <div className="px-4 py-2.5 border-t border-[#2a2a2a]">
          <div className="flex items-center justify-between text-[11px] text-[#737373]">
            <span>Grey v1.0.0</span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
              Online
            </span>
          </div>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
