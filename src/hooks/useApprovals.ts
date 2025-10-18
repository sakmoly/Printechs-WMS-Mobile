import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { erpApi } from "../api/erp";
import { USE_MOCK_DATA, mockApprovals } from "../api/mock";

export const useApprovalsInbox = () => {
  return useQuery({
    queryKey: ["approvals", "inbox"],
    queryFn: async () => {
      if (USE_MOCK_DATA) {
        await new Promise((resolve) => setTimeout(resolve, 700));
        return mockApprovals;
      }
      return erpApi.getApprovalsInbox();
    },
    staleTime: 2 * 60 * 1000, // 2 minutes
    gcTime: 5 * 60 * 1000,
  });
};

export const useApplyApproval = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: erpApi.applyApproval,
    onSuccess: () => {
      // Invalidate approvals inbox to refetch
      queryClient.invalidateQueries({ queryKey: ["approvals", "inbox"] });
    },
  });
};
