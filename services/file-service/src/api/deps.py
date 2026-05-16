from fastapi import Header, HTTPException, status


def get_current_user_id(
    x_gateway_user_id: str | None = Header(default=None),
    x_user_id: str | None = Header(default=None),
) -> str:
    user_id = (x_gateway_user_id or x_user_id or "").strip()
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unauthorized",
        )
    return user_id
