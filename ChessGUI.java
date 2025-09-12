import javax.swing.*;
import java.awt.*;
import java.awt.event.*;

public class ChessGUI extends JFrame {
    private final JButton[][] cells = new JButton[8][8];
    private final String[][] board = new String[8][8];
    private boolean isWhiteTurn = true;
    private int selectedRow = -1, selectedCol = -1;

    public ChessGUI() {
        setTitle("Chess Game ♛");
        setDefaultCloseOperation(EXIT_ON_CLOSE);
        setSize(640, 640);
        setLayout(new GridLayout(8, 8));
        initializeBoard();
        initializeUI();
        setVisible(true);
    }

    private void initializeBoard() {
        board[0] = new String[]{"♜", "♞", "♝", "♛", "♚", "♝", "♞", "♜"};
        board[1] = new String[]{"♟", "♟", "♟", "♟", "♟", "♟", "♟", "♟"};
        for (int i = 2; i < 6; i++) {
            for (int j = 0; j < 8; j++) {
                board[i][j] = " ";
            }
        }
        board[6] = new String[]{"♙", "♙", "♙", "♙", "♙", "♙", "♙", "♙"};
        board[7] = new String[]{"♖", "♘", "♗", "♕", "♔", "♗", "♘", "♖"};
    }

    private void initializeUI() {
        for (int i = 0; i < 8; i++) {
            for (int j = 0; j < 8; j++) {
                JButton button = new JButton(board[i][j]);
                button.setFont(new Font("SansSerif", Font.PLAIN, 36));
                button.setFocusable(false);
                int row = i, col = j;
                button.setBackground((i + j) % 2 == 0 ? Color.WHITE : Color.GRAY);
                button.addActionListener(e -> handleClick(row, col));
                cells[i][j] = button;
                add(button);
            }
        }
    }

    private void handleClick(int row, int col) {
        String piece = board[row][col];

        if (selectedRow == -1) {
            if (!piece.equals(" ") && isPieceTurn(piece)) {
                selectedRow = row;
                selectedCol = col;
                highlightMoves(row, col);
            }
        } else {
            if (cells[row][col].getBackground() == Color.YELLOW) {
                String captured = board[row][col];
                board[row][col] = board[selectedRow][selectedCol];
                board[selectedRow][selectedCol] = " ";

                if (captured.equals("♔")) {
                    JOptionPane.showMessageDialog(this, "Congratulations, Black wins!");
                    System.exit(0);
                }
                if (captured.equals("♚")) {
                    JOptionPane.showMessageDialog(this, "Congratulations, White wins!");
                    System.exit(0);
                }

                isWhiteTurn = !isWhiteTurn;
            }
            selectedRow = selectedCol = -1;
            clearHighlights();
            refreshBoard();
        }
    }

    private boolean isPieceTurn(String piece) {
        return (isWhiteTurn && "♔♕♖♗♘♙".contains(piece)) || (!isWhiteTurn && "♚♛♜♝♞♟".contains(piece));
    }

    private void highlightMoves(int row, int col) {
        String piece = board[row][col];
        clearHighlights();

        switch (piece) {
            case "♙":
                if (row > 0 && board[row - 1][col].equals(" "))
                    cells[row - 1][col].setBackground(Color.YELLOW);
                if (row == 6 && board[row - 1][col].equals(" ") && board[row - 2][col].equals(" "))
                    cells[row - 2][col].setBackground(Color.YELLOW);
                if (row > 0 && col > 0 && isOpponent(piece, board[row - 1][col - 1]))
                    cells[row - 1][col - 1].setBackground(Color.YELLOW);
                if (row > 0 && col < 7 && isOpponent(piece, board[row - 1][col + 1]))
                    cells[row - 1][col + 1].setBackground(Color.YELLOW);
                break;
            case "♟":
                if (row < 7 && board[row + 1][col].equals(" "))
                    cells[row + 1][col].setBackground(Color.YELLOW);
                if (row == 1 && board[row + 1][col].equals(" ") && board[row + 2][col].equals(" "))
                    cells[row + 2][col].setBackground(Color.YELLOW);
                if (row < 7 && col > 0 && isOpponent(piece, board[row + 1][col - 1]))
                    cells[row + 1][col - 1].setBackground(Color.YELLOW);
                if (row < 7 && col < 7 && isOpponent(piece, board[row + 1][col + 1]))
                    cells[row + 1][col + 1].setBackground(Color.YELLOW);
                break;
            case "♖":
            case "♜":
                highlightLineMoves(row, col, 1, 0);
                highlightLineMoves(row, col, -1, 0);
                highlightLineMoves(row, col, 0, 1);
                highlightLineMoves(row, col, 0, -1);
                break;
            case "♗":
            case "♝":
                highlightLineMoves(row, col, 1, 1);
                highlightLineMoves(row, col, 1, -1);
                highlightLineMoves(row, col, -1, 1);
                highlightLineMoves(row, col, -1, -1);
                break;
            case "♕":
            case "♛":
                highlightLineMoves(row, col, 1, 0);
                highlightLineMoves(row, col, -1, 0);
                highlightLineMoves(row, col, 0, 1);
                highlightLineMoves(row, col, 0, -1);
                highlightLineMoves(row, col, 1, 1);
                highlightLineMoves(row, col, 1, -1);
                highlightLineMoves(row, col, -1, 1);
                highlightLineMoves(row, col, -1, -1);
                break;
            case "♘":
            case "♞":
                highlightKnight(row, col);
                break;
            case "♔":
            case "♚":
                highlightKing(row, col);
                break;
        }
    }

    private void highlightLineMoves(int row, int col, int dRow, int dCol) {
        int r = row + dRow, c = col + dCol;
        while (r >= 0 && r < 8 && c >= 0 && c < 8) {
            if (board[r][c].equals(" ")) {
                cells[r][c].setBackground(Color.YELLOW);
            } else {
                if (isOpponent(board[row][col], board[r][c]))
                    cells[r][c].setBackground(Color.YELLOW);
                break;
            }
            r += dRow;
            c += dCol;
        }
    }

    private boolean isOpponent(String p1, String p2) {
        return (!p1.equals(" ") && !p2.equals(" ")) &&
               (Character.isUpperCase(p1.charAt(0)) != Character.isUpperCase(p2.charAt(0))) == false;
    }

    private void highlightKnight(int row, int col) {
        int[][] moves = {
            {-2, -1}, {-2, 1}, {-1, -2}, {-1, 2},
            {1, -2}, {1, 2}, {2, -1}, {2, 1}
        };
        for (int[] move : moves) {
            int r = row + move[0], c = col + move[1];
            if (r >= 0 && r < 8 && c >= 0 && c < 8 && (board[r][c].equals(" ") || isOpponent(board[row][col], board[r][c])))
                cells[r][c].setBackground(Color.YELLOW);
        }
    }

    private void highlightKing(int row, int col) {
        for (int dr = -1; dr <= 1; dr++) {
            for (int dc = -1; dc <= 1; dc++) {
                int r = row + dr, c = col + dc;
                if (dr == 0 && dc == 0) continue;
                if (r >= 0 && r < 8 && c >= 0 && c < 8 && (board[r][c].equals(" ") || isOpponent(board[row][col], board[r][c])))
                    cells[r][c].setBackground(Color.YELLOW);
            }
        }
    }

    private void clearHighlights() {
        for (int row = 0; row < 8; row++)
            for (int col = 0; col < 8; col++)
                cells[row][col].setBackground((row + col) % 2 == 0 ? Color.WHITE : Color.GRAY);
    }

    private void refreshBoard() {
        for (int row = 0; row < 8; row++)
            for (int col = 0; col < 8; col++)
                cells[row][col].setText(board[row][col]);
    }

    public static void main(String[] args) {
        SwingUtilities.invokeLater(ChessGUI::new);
    }
}
