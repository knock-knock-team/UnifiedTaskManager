package repository

import "errors"

var ErrNotFound = errors.New("task not found")
var ErrVersionConflict = errors.New("version conflict")
var ErrInvalidReorder = errors.New("invalid task reorder")
