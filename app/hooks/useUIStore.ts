// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { create } from "zustand";
interface UIState {
 selectedEmailId: string | null;
 selectEmail: (id: string | null) => void;
 closePanel: () => void;
 isSidebarOpen: boolean;
 openSidebar: () => void;
 closeSidebar: () => void;
 toggleSidebar: () => void;
}

export const useUIStore = create<UIState>((set) => ({
 selectedEmailId: null,
 selectEmail: (id) => set({ selectedEmailId: id }),
 closePanel: () => set({ selectedEmailId: null }),
 isSidebarOpen: false,
 openSidebar: () => set({ isSidebarOpen: true }),
 closeSidebar: () => set({ isSidebarOpen: false }),
 toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),
}));
