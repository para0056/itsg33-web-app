export type ControlIndexItem = {
  control_id: string;
  control_name: string;
  family_id?: string;
  aliases?: string[];
  keywords?: string[];
};

export type ControlRecord = {
  control_id: string;
  control_name?: string;
  statement?: string;
  control_statement?: string;
  statement_parts?: string[];
  guidance?: string;
  supplemental_guidance?: string;
  enhancements?: Array<string | Record<string, unknown>>;
  examples?: Array<string | Record<string, unknown>>;
  source_anchors?: Array<string | Record<string, unknown>>;
  related_controls?: string[];
};

export type CatalogMetadata = {
  catalog_title?: string | null;
  catalog_edition?: string | null;
  catalog_revision_number?: string | null;
  catalog_revision_date?: string | null;
  source_url?: string | null;
  source_api_url?: string | null;
  page_date_modified?: string | null;
  page_date_created?: string | null;
  extracted_at?: string | null;
};
