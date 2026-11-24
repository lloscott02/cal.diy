import { ListingItemDto } from "./listing-item.dto";

export interface ListingsResponseDto {
  status: "success";
  data: {
    items: ListingItemDto[];
    from: string; // ISO 8601
    to: string; // ISO 8601
  };
}
