"""Shared FastAPI error response metadata."""

BAD_REQUEST = {400: {"description": "Bad request"}}
FORBIDDEN = {403: {"description": "Forbidden"}}
NOT_FOUND = {404: {"description": "Not found"}}
CONFLICT = {409: {"description": "Conflict"}}
PAYLOAD_TOO_LARGE = {413: {"description": "Payload too large"}}
UNPROCESSABLE_CONTENT = {
    422: {
        "description": "Validation error or unprocessable content",
        "content": {
            "application/json": {
                "schema": {"$ref": "#/components/schemas/HTTPValidationError"}
            }
        },
    }
}
SERVER_ERROR = {500: {"description": "Internal server error"}}
BAD_GATEWAY = {502: {"description": "Bad gateway"}}


def error_responses(*statuses: int) -> dict[int, dict[str, str]]:
    """Build a FastAPI responses map for the provided error statuses."""
    definitions = {
        **BAD_REQUEST,
        **FORBIDDEN,
        **NOT_FOUND,
        **CONFLICT,
        **PAYLOAD_TOO_LARGE,
        **UNPROCESSABLE_CONTENT,
        **SERVER_ERROR,
        **BAD_GATEWAY,
    }
    return {status: definitions[status] for status in statuses}
