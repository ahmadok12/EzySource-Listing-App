import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  collectionContextSchema,
  collectionReferenceSchema,
  draftListResponseSchema,
  draftResponseSchema,
  sessionResponseSchema,
  type AddContactInput,
  type CreateDraftInput,
  type Draft,
  type SessionDefaults,
  type UpdateContactInput,
  type UpdateDraftInput,
} from "@ezysource/domain";
import { apiGet, apiSend } from "../lib/api";

export const collectionKeys = {
  reference: ["collection", "reference"] as const,
  context: ["collection", "context"] as const,
  drafts: ["collection", "drafts"] as const,
  draft: (id: string) => ["collection", "drafts", id] as const,
};

export function useReference() {
  return useQuery({
    queryKey: collectionKeys.reference,
    queryFn: () => apiGet("/collection/reference", collectionReferenceSchema.parse),
    staleTime: 10 * 60_000,
  });
}

export function useCollectionContext() {
  return useQuery({
    queryKey: collectionKeys.context,
    queryFn: () => apiGet("/collection/context", collectionContextSchema.parse),
  });
}

export function useDrafts() {
  return useQuery({
    queryKey: collectionKeys.drafts,
    queryFn: () => apiGet("/drafts?limit=50", draftListResponseSchema.parse),
  });
}

export function useDraft(id: string) {
  return useQuery({
    queryKey: collectionKeys.draft(id),
    queryFn: async () => (await apiGet(`/drafts/${id}`, draftResponseSchema.parse)).draft,
    // A 404 means "not yours or gone": don't retry it.
    retry: false,
  });
}

export function useSessionActions() {
  const client = useQueryClient();
  const refresh = () => client.invalidateQueries({ queryKey: collectionKeys.context });
  return {
    start: useMutation({
      mutationFn: (defaults: SessionDefaults) =>
        apiSend("POST", "/collection/sessions", defaults, sessionResponseSchema.parse),
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: ({ id, defaults }: { id: string; defaults: SessionDefaults }) =>
        apiSend("PATCH", `/collection/sessions/${id}`, defaults, sessionResponseSchema.parse),
      onSuccess: refresh,
    }),
    finish: useMutation({
      mutationFn: (id: string) =>
        apiSend("POST", `/collection/sessions/${id}/finish`, {}, sessionResponseSchema.parse),
      onSuccess: async () => {
        await refresh();
        // Immediate-handoff drafts close with the session.
        await client.invalidateQueries({ queryKey: collectionKeys.drafts });
      },
    }),
  };
}

export function createDraft(input: CreateDraftInput, idempotencyKey: string) {
  return apiSend("POST", "/drafts", input, draftResponseSchema.parse, {
    "idempotency-key": idempotencyKey,
  });
}

/** Saves to a draft and puts the server's new version straight into the cache. */
export function useDraftActions(id: string) {
  const client = useQueryClient();
  const store = ({ draft }: { draft: Draft }) => {
    client.setQueryData(collectionKeys.draft(id), draft);
    void client.invalidateQueries({ queryKey: collectionKeys.drafts, exact: true });
  };
  return {
    update: useMutation({
      mutationFn: (input: UpdateDraftInput) => apiSend("PATCH", `/drafts/${id}`, input, draftResponseSchema.parse),
      onSuccess: store,
    }),
    addContact: useMutation({
      mutationFn: (input: AddContactInput) =>
        apiSend("POST", `/drafts/${id}/contacts`, input, draftResponseSchema.parse),
      onSuccess: store,
    }),
    updateContact: useMutation({
      mutationFn: ({ contactId, input }: { contactId: string; input: UpdateContactInput }) =>
        apiSend("PATCH", `/drafts/${id}/contacts/${contactId}`, input, draftResponseSchema.parse),
      onSuccess: store,
    }),
  };
}
