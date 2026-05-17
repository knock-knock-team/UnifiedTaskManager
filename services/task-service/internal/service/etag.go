package service

import (
	"fmt"
	"strconv"
	"strings"
)

func TaskETag(version int64) string {
	return fmt.Sprintf(`"%d"`, version)
}

func ColumnETag(version int64) string {
	return fmt.Sprintf(`"%d"`, version)
}

func ParseIfMatchHeader(value string) (int64, bool) {
	value = strings.TrimSpace(value)
	if value == "" || value == "*" {
		return 0, false
	}
	if strings.HasPrefix(value, "W/") {
		value = strings.TrimPrefix(value, "W/")
	}
	value = strings.Trim(value, `"`)
	if value == "" {
		return 0, false
	}
	version, err := strconv.ParseInt(value, 10, 64)
	if err != nil || version <= 0 {
		return 0, false
	}
	return version, true
}
